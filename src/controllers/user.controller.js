import { asynchandler } from "../utils/asynchandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../models/cloudinary.js";
import { ApiResponse } from "../utils/apiResponse.js";
import jwt from "jsonwebtoken";


const generateAccessAndRefreshToken = async(userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = await user.generateAccessToken();
        const refreshToken = await user.generateRefreshToken();
        user.refreshToken = refreshToken;
        await user.save({validateBeforeSave: false});

        return {accessToken, refreshToken};
    } catch (error) {
        throw new ApiError(500, "Token generation failed");
    }
};

const registerUser = asynchandler(async (req, res) => {
    // get user data from frontend
    // validation - not empty, valid email, password length, etc.
    // check if user already exists: username or email
    // check for images and avatar
    // upload image to cloudinary, avatar and cover image
    // create user object - create entry in database
    // remove password and refresh token from response
    // check for user creation
    // ṛeturn response

    const {fullname, email, username, password} = req.body
    // console.log(`fullname: ${fullname}`);

    // if(!fullname || !email || !username || !password){
    //     return res.status(400).json({
    //         success: false,
    //         message: "All fields are required"
    //     }) 
    // }

    if(
        [fullname,email,username,password].some((field) => 
            field?.trim() === ""
        )
    ){
        throw new ApiError(400,"All fields are required");
    }

    const existedUser = await User.findOne({
        $or: [{email} , {username}]
    })
    if(existedUser){
        throw new ApiError(409, "User already exists with this email or username");
    }

    const avatarfilepath = req.files?.avatar[0]?.path;
    const coverImagePath = req.files?.coverImage[0]?.path;

    if(!avatarfilepath){
        throw new ApiError(400,"Avatar is required");
    }

    const avatar = await uploadOnCloudinary(avatarfilepath);
    const coverImage = await uploadOnCloudinary(coverImagePath);
     
    if(!avatar){
        throw new ApiError(500,"Avatar upload failed");
    }

    const user = await User.create({
        fullname,
        email,
        username: username.toLowerCase(),
        password,
        avatar: avatar.url,
        coverImage: coverImage?.url || ""
    })

    if(!user){
        throw new ApiError(500,"User creation failed");
    }

    res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
            id: user._id,
            fullname: user.fullname,
            email: user.email,
            username: user.username,
            avatar: user.avatar,
            coverImage: user.coverImage
        }
    })

    const createdUser = await User.findById(user._id).select("-password -refreshToken");

    if(!createdUser){
        throw new ApiError(500,"User creation failed");
    }

    return res.status(201).json(
        new ApiResponse(201, createdUser, "User registered successfully")
    )
})

const loginUser = asynchandler(async (req, res) => {
    // get user data from frontend - email and password
    // validate - email and password not empty
    // check if user exists with email
    // handle not case - user not found
    // check if password is correct
    // handle not case - password incorrect
    // generate access token and refresh token
    // save refresh token in user document
    // return response with user data and tokens

    const {email, username, password} = req.body;
    if(!email && !username){
        throw new ApiError(400,"Email or username is required");
    }
    if(!password){
        throw new ApiError(400,"Password is required");
    }
    const user = await User.findOne({
        $or: [{email} , {username}]
    })
    if(!user){
        throw new ApiError(404,"User not found");
    }
    const isPasswordValid = await user.isPasswordCorrect(password);
    if(!isPasswordValid){
        throw new ApiError(401,"Invalid password");
    }

    const {accessToken, refreshToken}  = await generateAccessAndRefreshToken(user._id);

    const updatedUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user : updatedUser,
                refreshToken
            },
            "User logged in successfully"
        )
    )
})

const logoutUser = asynchandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly : true,
        secure : true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, null, "User logged out successfully")
    )
})

const refreshAccessToken = asynchandler(async (req, res) => {
    const incomingRefreshToken = req.cookies?.refreshToken || req.headers("Authorization")?.replace("Bearer ", "");
    if(!incomingRefreshToken){
        throw new ApiError(401, "unauthorized, refresh token is required");
    }
    
    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");
        if(!user){
            throw new ApiError(404, "User not found");
        }
        if(user.refreshToken !== incomingRefreshToken){
            throw new ApiError(401, "Invalid refresh token");
        }
    
        const options = {
            httpOnly: true,
            secure: true
        }
        const {accessToken , newrefreshToken} = await generateAccessAndRefreshToken(user._id);
        return res.status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newrefreshToken, options)
        .json(
            new ApiResponse(200, { accessToken, refreshToken: newrefreshToken }, "Access token refreshed successfully")
        );
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
        
    }
})

const getUserProfile = asynchandler(async (req, res) => {
    const {username} = req.params;

    if(!username?.trim()){
        throw new ApiError(400, "Username is required");
    }
    const channel = User.aggregate([
        {
            $match: {
                username: username.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {$size: "$subscribers"},
                subscribedToCount: {$size: "$subscribedTo"},
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullname: 1,
                username: 1,
                email: 1,
                avatar: 1,
                coverImage: 1,
                subscribersCount: 1,
                subscribedToCount: 1,
                isSubscribed: 1
            }
        }
    ])
    if(!channel?.length){
        throw new ApiError(404, "Channel not found");
    }
    return res.status(200).json(
        new ApiResponse(200, channel[0], "User profile fetched successfully")
    );
})


const getWatchHistory = asynchandler(async (req, res) => {
    const user = await User.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullname: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]          
            }
        }
    ])
    return res.status(200)
    .json(
        new ApiResponse(200, user[0]?.watchHistory || [], "Watch history fetched successfully")
    )              
})


export { registerUser, loginUser, logoutUser, refreshAccessToken, getUserProfile, getWatchHistory};