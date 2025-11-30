export default ({ env }) => ({
  upload: {
    config: {
      provider: 'cloudinary',
      providerOptions: {
        cloud_name: env('CLOUDINARY_NAME'),
        api_key: env('CLOUDINARY_KEY'),
        api_secret: env('CLOUDINARY_SECRET'),
      },
      actionOptions: {
        upload: {
          folder: env('CLOUDINARY_FOLDER', 'dev'), // dev, staging, ou production
        },
        uploadStream: {
          folder: env('CLOUDINARY_FOLDER', 'dev'),
        },
        delete: {},
      },
    },
  },
});
