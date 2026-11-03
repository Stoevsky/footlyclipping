import { registerCommands } from '../src/bot.js';
import { config } from '../src/config.js';
for (const [key,value] of [['DISCORD_BOT_TOKEN',config.token],['DISCORD_CLIENT_ID',config.clientId],['DISCORD_GUILD_ID',config.guildId]]) {
  if(!value) throw new Error(`Missing configuration: ${key}`);
}
await registerCommands();
