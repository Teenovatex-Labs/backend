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

// --- private images (team chat attachments) -----------------------------------------------------
// Stored with type "authenticated": there is no public address. The only way to see one is a signed
// link that the API hands to someone allowed to view it.

/** Only these image types are accepted for attachments; GIFs, video and documents are not. */
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'INVALID_FILE_TYPE', 'Images must be JPG, PNG or WebP'));
  },
});

export const uploadPrivateImage = (buffer: Buffer, folder: string): Promise<{ public_id: string }> =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, resource_type: 'image', type: 'authenticated' }, (err, result) => {
        if (err ?? !result) reject(err ?? new Error('Upload failed'));
        else resolve({ public_id: result!.public_id });
      })
      .end(buffer);
  });

export const signedImageUrl = (publicId: string): string =>
  cloudinary.url(publicId, { type: 'authenticated', sign_url: true, secure: true, resource_type: 'image' });

export const deletePrivateImage = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image', invalidate: true });
  } catch {
    // a missing file is not worth failing a moderation action over
  }
};
