// Vercel function entry. Everything is rewritten here by vercel.json, so the
// Fastify router sees the original path. The build step compiles src/ to
// dist/ first; this file only has to hand the request over.
export { default } from "../dist/serverless.js";
