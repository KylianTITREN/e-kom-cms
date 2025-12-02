import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Middleware pour conserver le body brut pour les webhooks Stripe
    // Doit être enregistré AVANT les middlewares de parsing du body
    strapi.server.use(async (ctx, next) => {
      if (ctx.request.url === '/api/webhook/stripe' && ctx.request.method === 'POST') {
        // Capturer le body brut avant que Koa ne le parse
        const chunks: Buffer[] = [];

        // Lire le stream complet
        for await (const chunk of ctx.req) {
          chunks.push(chunk);
        }

        const rawBody = Buffer.concat(chunks).toString('utf8');

        // Stocker le body brut dans un symbole pour éviter les conflits
        if (!ctx.request.body) {
          ctx.request.body = {};
        }
        ctx.request.body[Symbol.for('unparsedBody')] = rawBody;

        console.log('✅ Body brut capturé pour webhook Stripe');
      }

      await next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
