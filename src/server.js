import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.locals.ready
  .then(() => {
    app.listen(port, () => {
      console.log(`File manager is running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to prepare storage directory:', error);
    process.exit(1);
  });
