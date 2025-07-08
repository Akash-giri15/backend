import {ApiError} from "../utils/apiError.js";
import {asynchandler} from "../utils/asynchandler.js";
import jwt from "jsonwebtoken";
import {User} from "../models/user.model.js";

export const verifyJWT = asynchandler(async(req,res,next) => {

try {
        const token = req.cookies?.accessToken 
        || req.headers["Authorization"]?.replace("Bearer ", "");
    
        if(!token){
            throw new ApiError(401, "Access token is required");
        }
        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");
    
        if(!user){
            throw new ApiError(404, "User not found");
        }
        req.user = user;
        next()
    } catch (error) {
        throw new ApiError(401, "Invalid access token"); 
    }

})