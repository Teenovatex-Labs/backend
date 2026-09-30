import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new HttpError(400, 'INVALID_FILE_TYPE', 'Only image files are allowed'));
  },
});

export const uploadToCloudinary = (buffer: Buffer, folder: string): Promise<string> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, resource_type: 'image' }, (err, result) => {
        if (err ?? !result) reject(err ?? new Error('Upload failed'));
        else resolve(result!.secure_url);
      })
      .end(buffer);
  });
