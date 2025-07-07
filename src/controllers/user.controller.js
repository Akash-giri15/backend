import { asynchandler } from "../utils/asynchandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../models/cloudinary.js";
import { ApiResponse } from "../utils/apiResponse.js";


const generateAccessAndRefreshToken = async(userId){
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
}




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
    const user = User.findOne({
        $or: [{email} , {password}]
    })
    if(!user){
        throw new ApiError(404,"User not found");
    }
    const isPasswordCorrect = await user.isPasswordCorrect(password);
    if(!isPasswordCorrect){
        throw new ApiError(401,"Invalid password");
    }

    const {accessToken, refreshToken}  = await generateAccessAndRefreshToken(user._id);

    const updatedUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly = true,
        secure = true,
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
        httpOnly = true,
        secure = true,
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(
        new ApiResponse(200, null, "User logged out successfully")
    )
})


export { registerUser, loginUser, logoutUser

 };