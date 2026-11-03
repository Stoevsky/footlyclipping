# Footly Growth Bot v1

**Discord bot za Footly, so poraki na makedonski (latinica, obichna tastatura).**
Ne kreira novi Discord kanali: se povrzuva so tvoite postoechki kanali preku nivnite IDs.

## Shto e izgradeno

| Funkcija | Komanda / kanal | Kako raboti |
|---|---|---|
| Viral alerti | `CHANNEL_VIRAL_ALERTS` | Prati embed koga video kje pomine 50K+ pregledi (podeslivo) |
| Growth alerti | `CHANNEL_CREATOR_GROWTH` | Sledbenichki milestones |
| Leaderboard | `CHANNEL_LEADERBOARD` | Eden postojan post, koj botot go **editira** pri osvezhuvanje |
| Dneven izvestaj | `CHANNEL_DAILY_ANALYTICS` | 09:00 Europe/Skopje, za prethodniot den |
| AI agent (read-only) | `/prasaj` vo `CHANNEL_FOOTLY_AI` | Odgovori bazirani na stats od Viral.app, so opcionen OpenAI key |
| Novi objavi | `CHANNEL_NEW_VIDEOS` | Opciono: nova objava otkriena so sync |
| Slash komandi | `/top`, `/izvestaj`, `/prasaj`, `/status`, `/osvezi`, `/test` | Komandite se registriraat avtomatski pri start |

**Vazno za tocnosta:** API `GET /analytics/top-accounts` vrakja **maksimum 100 profili**. Ako sledish povekje od 100, leaderboard i zbirnite presmetki vo ovaa v1 verzija se *delumni*. Botot vo toj sluchaj eksplicitno stava predupreduvanje namesto da prikazhe necelosen zbir kako celosen. Za >100 kompletna analitika e sledna faza (batched/paginated analytics eksport). Maksimumot za top videos kontekstot vo AI e 12, a za AI prompt prikazot e prvite 25 profili.

Botot ne pravi novi tracking profili, ne isprakja DM-ovi do kreatori i ne pravi isplati.

## Plan za pustanje (1 - 2 - 3 - 4)

### 1. Discord aplikacija

1. Otvori https://discord.com/developers/applications -> **New Application** -> `Footly Growth Bot`.
2. Vo **Bot** napravi bot i zemi token. **Ne go prakjaj nikomu.**
3. Vo **Installation / OAuth2 URL Generator**, izberi `bot` + `applications.commands`. Dozvoli samo: View Channels, Send Messages, Embed Links, Read Message History.
4. Invitiraj go botot vo tvojot postoechki Footly Discord server.
5. Vo Discord Settings -> Advanced -> **Developer Mode ON**. Desen klik na serverot -> Copy Server ID. Desen klik na sekoj od tvoite kanali -> Copy Channel ID.
6. Zemi `Application ID` od General Information, ne Bot token.

### 2. Baza i 24/7 hosting (Railway)

1. Napravi nov private GitHub repo i postavi gi fajlovite od ovaa papka. **Ne commitiraj `.env`**.
2. Vo Railway napravi **New Project**, prikluchi GitHub repo za aplikacijata, i dodadi **Postgres** servis vo istiot Railway project.
3. Vo bot servisot namesti `DATABASE_URL` kako reference na Postgres `DATABASE_URL` variable (Railway UI -> Add Reference). Railway internal database obichno nema potreba od `DATABASE_SSL=true`.
4. Vo **Variables** dodadi gi site obavezni variables od `.env.example`. Stavi `PORT` na `3000` ako ne e postaven.
5. Deploy. Za produkcija ostavi **1 replica**, ne dozvoluvaj botot da zaspiva.
6. Vo bot servis -> Networking -> **Generate Domain**. Tvojata javna adresa kje bide vo stil `https://footly-growth-bot.up.railway.app`.
7. Proveri `https://TVOJ-DOMAIN/health` - treba da vrati `{"ok":true,...}`.

### 3. Viral.app webhook

1. Otvori Viral.app -> Organization -> API -> **API Keys**. Kreiraj API key za read-only statistika, kopiraj go vo Railway `VIRAL_API_KEY`.
2. Organization -> API -> **Webhooks** -> **Add Endpoint**.
3. URL: `https://TVOJ-DOMAIN/webhooks/viral-app`.
4. **Explicitno chekiraj gi ovie tracking event types**:
   - `video.views_milestone`
   - `account.followers_milestone`
   - `organization.synced`
   - `sync.completed`
   - `video.published` (samo ako sakash novi objavi)
5. Vazno: opcijata **All events** NE gi vkluchuva avtomatski tracking events. Mora racno da gi izberesh.
6. Pri kreiranje endpoint Viral.app prikazhuva `whsec_...` signing secret. Dodadi go vo Railway `VIRAL_WEBHOOK_SECRET`, pa redeploy.
7. Vo Viral.app klikni **Send Test Event**. Vo Railway logs treba da se pojavi `[webhook] Test event primen i verifikuvan.`. Test event obichno ne objavuva javna Discord poraka.

Viral.app isprakja HTTP POST so Standard Webhooks podpis. Botot go validira **suroviot body**, HMAC i 5-minutniot timestamp; bazata gi deduplicira povtorenite isporaki. Ako bazata e nedostapna, endpointot vrakja 503 za Viral.app da povtori. Botot brzo odgovara 204 po zapis vo bazata, a poseben worker ja pravi Discord rabotata.

### 4. Proverka vo Discord

- `/test` - privatna test poraka, bez spam vo kanalite.
- `/status` - dali botot raboti i kolku webhook eventi ima vo redica.
- `/top metrika:nedela` - top 10 profili po dobieni pregledi vo 7 dena.
- `/top metrika:sledbenici` - najgolemi profili po broj sledbenici.
- `/top metrika:vkupno` - lifetime pregledi.
- `/top metrika:objavi` - objavi vo 7 dena.
- `/top metrika:engagement` - engagement rate vo 7 dena.
- `/izvestaj` - vcherashen report.
- `/osvezi` - rachno azhuriranje na postojaniot leaderboard (Manage Server permission).
- `/prasaj prashanje:Koj ima najmnogu pregledi ovaa nedela?` - AI odgovor vo #footly-ai (potreben OPENAI_API_KEY).

**Napomena:** `/top` pokazuva momentalna Viral.app statistika od API. Webhook milestones se za *novite* premini po pretplata; starite viral videa ne se prakaat retroaktivno kako alert. Vremeto na alert zavisi od Viral.app sync, ne od sekunda po objavuvanje.

## Lokalno testiranje na Mac

```bash
cp .env.example .env
# vnesi gi tokenite/IDs vo .env (vo editor, ne vo chat)
npm install
npm test
npm run dev
```

Vo drug Terminal:

```bash
npm run simulate
```

`simulate` generira pravilno potpisan lokalen *lazhen* video milestone za `@footly.test`. Ako botot i webhookot rabotat, za ~45-60 sekundi kje se pojavi **TEST** viral alert vo realniot Discord kanal. Koristi go samo vo interen server; ne e vistinska analitika.

## Konfiguracija

Vidi `.env.example`. Potrebni: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `VIRAL_API_KEY`, `VIRAL_WEBHOOK_SECRET`, `DATABASE_URL`. Site 5 osnovni CHANNEL_* ID-a se obavezni, osven opcionot CHANNEL_NEW_VIDEOS. `OPENAI_API_KEY` e opcionen i ne e potreben za alerti ili leaderboards.

`MIN_VIRAL_VIEWS=50000` -> se alarmira za milestones >=50K; Viral.app isprakja 10K,50K,100K,250K,500K,1M,5M,10M. Koga eden sync isprakja povekje milestones za isto video, botot cheka 45 sekundi i se obiduva da gi spoi vo samo eden alert so najvisokiot prag.

`MIN_FOLLOWERS=10000` -> alert za sledbenici 10K i nagore. Competitor accounts se izostaveni od alerti i ranking (`viewMode=internal`).

`REPORT_TIMEZONE=Europe/Skopje`; `DAILY_REPORT_CRON=0 9 * * *` za 09:00 sekoj den. Botot koristi data od *vcherashniot* datum za dnevniot izvestaj.

**Bezbednost:** Nikogash ne prakjaj Bot Token, Viral API Key, webhook `whsec_` ili OpenAI API key vo Discord/chat. Chuvaj gi samo vo Railway Variables i lokalno `.env`. Ogranichi pristap do Railway/GitHub repo; koristi private repository.

## API dokumentacija

- Viral.app webhooks: https://viral.app/docs/brands/api/webhooks
- Viral.app OpenAPI spec: https://viral.app/api/v1/openapi.json
- Discord slash commands: https://docs.discord.com/developers/docs/interactions/slash-commands

## Sledna faza (posle uspeshen live test)

1. Celosni leaderboards za **povekje od 100 accounts**, so oficijalna pagination/export strategija.
2. Nedelen growth review (najgolem porast, najdobar creator, slab posting consistency).
3. Napredni per-creator analizi, CPM/ROI so provereni podatoci za trosok.
4. Role permissions za marketing i finance tim.
5. Dodatna monitoring/dashboard stranica i alerts ako API ili sync ne raboti.

## Ogranichuvanja i status

Izvoren kod: gotov pochetok; avtomatskite testovi za potpis/datum/link pominaa. **Ne e testirano so tvoj Discord server, Viral.app keys ili Railway**, zatoa shto nemame pristap do tvoite secrets i hosting. Railway deploy i live integration se posledniot chekor.

Za produkcija ostavi samo **1 bot replica**. Prvata verzija nema globalen locking za povekje repliki, niti garancija za exactly-once Discord objava ako aplikacijata se restartira vo momentot posle `send` a pred DB update. Baza i dedupe gi sprechuvaat povekjeto povtoruvanja, no Discord send i DB write ne se atomichna operacija.
