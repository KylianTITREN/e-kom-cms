export default {
  async uploadEngravingLogo(ctx) {
    try {
      const { files } = ctx.request;

      if (!files || !files.logo) {
        ctx.status = 400;
        ctx.body = { error: 'Aucun fichier fourni' };
        return;
      }

      const file = Array.isArray(files.logo) ? files.logo[0] : files.logo;

      // Upload vers Cloudinary via le plugin Strapi Upload
      const uploadedFiles = await strapi.plugins.upload.services.upload.upload({
        data: {
          fileInfo: {
            name: file.name,
            caption: 'Logo de gravure',
            alternativeText: 'Logo de gravure',
          },
        },
        files: file,
      });

      const uploadedFile = uploadedFiles[0];

      ctx.body = {
        success: true,
        url: uploadedFile.url,
        name: uploadedFile.name,
        id: uploadedFile.id,
      };
    } catch (error: any) {
      console.error('❌ Erreur upload logo gravure:', error);
      ctx.status = 500;
      ctx.body = {
        error: 'Erreur lors de l\'upload du logo',
        message: error?.message || 'Erreur inconnue',
      };
    }
  },
};
