const dotenv = require('dotenv');

dotenv.config();

const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on port ${config.port}`);
});
