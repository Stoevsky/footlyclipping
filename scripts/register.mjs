import { registerCommands } from '../src/bot.js';
import { validateConfig } from '../src/config.js';
validateConfig();
await registerCommands();
