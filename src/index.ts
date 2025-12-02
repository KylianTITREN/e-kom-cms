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
    strapi.server.use(async (ctx, next) => {
      if (ctx.request.url === '/api/webhook/stripe' && ctx.request.method === 'POST') {
        // Capturer le body brut AVANT que les autres middlewares ne le parsent
        const chunks: Buffer[] = [];

        // Lire le stream complet
        for await (const chunk of ctx.req) {
          chunks.push(chunk);
        }

        const rawBody = Buffer.concat(chunks).toString('utf8');

        // Parser manuellement le JSON pour ctx.request.body
        try {
          ctx.request.body = JSON.parse(rawBody);
        } catch (e) {
          ctx.request.body = {};
        }

        // Stocker AUSSI le body brut dans un symbole pour la vérification de signature
        ctx.request.body[Symbol.for('unparsedBody')] = rawBody;

        console.log('✅ Body brut capturé pour webhook Stripe:', rawBody.substring(0, 100) + '...');

        // Appeler next() pour continuer, mais le body est déjà parsé donc koa-body ne fera rien
        await next();
        return;
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
