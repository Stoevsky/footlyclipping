# FOOTLY GROWTH BOT — PLAN

## Cel

24/7 bot koj prima signed Viral.app webhook events, gi pretvora vo Discord notifikacii i pravi aktualni ranking izveshtai za Footly marketing timot. Site bot poraki na makedonski so latinica bez posebni bukvi.

## Arhitektura

```text
Viral.app tracking + analytics
          |                  |
     signed webhook     read-only API
          |                  |
          v                  v
  Node.js HTTP server -> Postgres queue -> Worker
                             |             |
                             |             v
                             |       Discord alerts
                             |       (/viral, /growth)
                             v
                    discord.js + slash commands
                             |
                    leaderboard + izvestai
                             |
                    opcionen AI read-only Q&A
```

## Faza 1 — V1, izgradena vo izvorniot kod

- [x] Postoechki Discord kanali preku IDs, bez kreiranje novi.
- [x] Signed webhook endpoint + 5-minute timestamp check.
- [x] Event ID dedupe vo PostgreSQL i retry redica.
- [x] 45 sekundi spojuvanje na video milestone eventi (od ist sync).
- [x] 50K+ viral alerts, 10K+ follower alerts.
- [x] Postojan, editiran leaderboard vo poseben kanal.
- [x] Leaderboard za novi i vkupni pregledi, followers, objavi i engagement.
- [x] Dneven izvestaj vo 09:00 po Skopje vreme.
- [x] AI read-only `/prasaj` so opcionen API key.
- [x] `/top`, `/izvestaj`, `/status`, `/test`, `/osvezi`.
- [x] Testovi za signature, datumi i URL security.
- [ ] Realno povezuvanje so tvoj Discord bot token/Channel IDs.
- [ ] Realno povezuvanje so tvoj Viral.app API/webhook.
- [ ] Railway deploy so PostgreSQL i public HTTPS domain.
- [ ] Live test na 1 vistinski event.

## Faza 2 — Po prviot live test

- [ ] Celosna analitika za 100+ profili so export/pagination strategija (bez netochni delumni totals).
- [ ] Trend analiza po kreator so periodni snapshoti i promeni od nedela vo nedela.
- [ ] Nedelen report vo ponedelnik (najdobar kreator, video, posting consistency).
- [ ] Score 0-100 po objasniva formula, ne izmislen AI score.
- [ ] Per-team roles za AI, ops, admin i privatni kanali.

## Faza 3 — Poodmaknat AI

- [ ] Analiza na performans po kreator, slichni hook formati i strategii.
- [ ] Koga se dostapni trosoci: CPM, cost per view, retention and ROI.
- [ ] AI recommendations so izvori na stats i chekor-po-chekor preporaki.
- [ ] Alerts za neaktivni kreatori i slabi performansi na osnov na realni thresholds.

## Acceptance test pred produkcija

1. `/test` funkcionira privatno i ne spama na kanali.
2. `/top metrika:nedela` i `/top metrika:sledbenici` prikazhuvaat vistinski podatoci od Viral.app.
3. `Send Test Event` od Viral.app stiga so potpis i HTTP 204.
4. Ist webhook ID praten 2 pati kreira samo eden event vo bazata.
5. Mock milestone po 45 sec isprakja samo edna notifikacija.
6. Restart na aplikacijata ne kreira nov leaderboard post, tuku go editira postoechkiot.
7. `/prasaj` ne izmisluva podatoci za nedostapni profili.
8. `/health` vrakja 200 dodeka DB e zdrava.

## Ops rizici

- Ne e sekundna detekcija: Viral.app webhookot zavisi od rasporedot za sync.
- V1 e za edna Railway replika.
- Nedostapni creds / no API access znachi nema pristap do Viral.app.
- V1 go ogranicuva analytics API na 100 top accounts; dolzhni sme da go kazheme jasno.
- Nikogash ne prakjaj secrets vo Discord ili javni kod repozitoriumi.
