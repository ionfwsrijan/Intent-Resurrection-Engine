import { createServerApp } from "./app.mjs";

const app = await createServerApp();
await app.listen();

console.log(`Intent Resurrection Engine running at ${app.baseUrl}`);
