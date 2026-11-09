# Ninja Saga Mission Bot

A local Chrome/Brave extension (no AI, no API tokens) that runs Ninja Saga missions
automatically on ninjasaga.cc, which plays the original SWF through Ruffle.

## Install

1. Open `chrome://extensions` (or `brave://extensions`)
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `ninja-saga-bot` folder
4. Open or reload `https://ninjasaga.cc/play`, log in and wait for the village
5. The **Ninja Saga Bot** panel appears bottom right: click **Start** or press `Alt+S`

## Hot reload (development)

```
node dev-server.js
```

The server on `127.0.0.1:8777` watches the files; the extension background checks every 2 seconds:

| Changed file | What happens |
|---|---|
| `bot.js` | Injected straight into the game tab; the game does not reload, mission count and chakra lock carry over |
| `hook.js` | The extension reloads and the game page reloads the next time the bot is in the village |
| `manifest.json`, `background.js`, `poller.js` | The extension reloads itself and re-injects the bot |

Without the server the extension works normally; only hot reload is off.

### Start the server with the bot (Native Messaging)

Register once:

```
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp com.billy.nsbot.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
```

Edit `path` in `com.billy.nsbot.json` to where `native-host.js` lives on your machine, and
`allowed_origins` to your extension ID. Start in the panel then launches `native-host.js`
(the hot reload server) and Stop shuts it down.

## How it works

The bot reads pixels from the game canvas and recognises screens:

| Screen | Sign | Action |
|---|---|---|
| Your turn | blue Run + orange Dodge buttons | attack or use jutsu on an enemy |
| Battle (enemy turn / animations) | purple timeline or yellow goal bar | wait |
| Story dialog | black bars top and bottom | click through |
| Victory / Mission Success / mission start | green checkmark | click the checkmark |
| Village | rank progress bar at the top | Mission Room > Grade > page > row > checkmark |
| Tutorial popup / panel (Shop, etc.) | small red X with a white cross | click X (the green "Go to Academy" button is never clicked) |
| Mission map (scrolling area) | orange "Go!" arrow right/left | click enemies first; "Go!" only when none are left. A character that does not start a fight is the player: its colours are remembered and skipped |
| "Click the enemy" cutscene | unrecognised for > 0.6 s | click detected characters (max. 3), otherwise wait without clicking |

### Choosing the mission

With **Auto highest-XP mission** on, the bot picks the mission with the highest base XP whose
required level is at or below the character's level, using the mission table from
`MissionDetail` in `data_library_en.swf` (sorted by level, no special missions; Grade A/B/C
buttons = internal grades C/D/E). XP does not rise on every row, so this is not simply the last
unlocked row. If that mission does not start (wrong level), the bot falls back to scanning the
padlocks on screen.

The mission list reopens on the page viewed last. Pages are recognised by a fingerprint of the
title bars, learned per grade (`localStorage.nsPageFps`), so the bot presses next/prev straight
to the target page and only rewinds when a page has never been seen. A page turn is judged on
the settled titles, so a slow slide never causes a double press.

### Level and XP from the HUD

The HUD prints `current / needed` XP in white over the XP bar. The bot reads these digits
(glyph samples matched against an 8x12 whiteness mask) and accepts a reading only when the
needed figure equals `round(L x 130 x 50^(L/50))` (`Formula.getXpByLv`) for some level L, which
also gives the level exactly. **Current level** in the panel is updated from it every 5 seconds,
also while the bot is stopped; one level up goes through the normal level-up handling so exam
levels and targets still stop the bot. Reading the digits needs a high-DPI (Retina) canvas;
otherwise the bot falls back to the length of the bar.

### Memory patches

`hook.js` runs in the `/emulator` iframe before Ruffle loads and captures Ruffle's
`WebAssembly.Memory`. Each cheat is applied on its own per game memory:

| Cheat | Pattern | Effect |
|---|---|---|
| Jutsu damage (AOB) | `A2 25 E8 07 A3 A2` -> `...A9 A2` | AVM2 `/1000` becomes `\|1000` in `calcSkillDamage` |
| Basic attack 400000 | `24 00 0F 06 00 00 2D A6 01 75 63 08` -> `...0F 00 00 00...` | `BattleProcessor.setCharacterCommand` gives admin IDs a weapon damage of 400000; the `ifnge +6` jump becomes `+0` |
| Lock chakra | number slot between two slots holding 100, HP 32 bytes before, gold 32 bytes after (largest gold wins) | chakra is held full |

Unticking a cheat does not restore the original bytes; reload the page in the village to drop
a patch. The hook only works when the extension is active **before** the game page loads.

### Settings

| Option | Default | Notes |
|---|---|---|
| Character slot | 1 | Card on the character select screen (1-2 top row, 3-4 middle, 5-6 bottom); used when logging back in after a recovery reload |
| Current level | 0 | Filled from the HUD; also increases on every Level Up screen |
| Target level | 0 | Goal for the progress bar; the bot stops in the village when reached. 0 = next stop level |
| Stop at levels | 20,40,60,80,100 | Rank exam levels; the bot stops in the village there |
| Auto highest-XP mission | on | See "Choosing the mission" |
| Grade / Page / Row | A / 2 / 1 | Manual mission when auto is off |
| Attack style | Basic attack | `Basic attack`: Attack every turn (heal when HP is low); `Jutsu`: use the jutsu slot order |
| Jutsu slot order | 1,8,7,3,6,5,4 | Slots 1-4 left, 5-8 right of the Attack button; unlisted slots are tried last. Saved per mission |
| Heal slot | 2 | Used only when HP < 35%; 0 = none |
| Mode | Auto bot | `Cheat only`: you play yourself, the bot only applies the ticked cheats |
| Game sound | off | Muted through a gain of 0 (AudioContext keeps running: battles wait for sound events) |
| Auto recovery | on | Reload and resume on a Ruffle error or a 90 s stall |
| Stable turbo | on | See "Speed" |
| Extreme battle | off | See "Speed" |

Settings are kept in localStorage and apply from the next mission navigation.

### Speed

The 1x-5x buttons speed up the game clock (`requestAnimationFrame`, `performance.now` and the
audio clock in the iframe). Battles wait for sound-complete events, so the audio clock is scaled
too. While any call to the game server is pending, the clock drops to 1x; otherwise network
timeouts would also be sped up and the game shows "Sorry, you have lost connection".

**Stable turbo** switches speed per phase: battles at the highest safe speed (up to 5x),
everything else at 4x. A page load the bot did not ask for while running (lost connection,
Ruffle crash, stall) counts against the active phase, which drops one step; after 25 clean
missions it tries one step higher, unless that speed already failed twice.

**Extreme battle** lets battles climb above 5x (up to 8x, one step every 5 clean missions).
Above 5x frames are driven by a `MessageChannel` tick, which has no 4 ms timer clamp; this keeps
one CPU core busy during battles.

### Token guard

While the bot runs, `hook.js` reads the service name of every AMF call and **blocks** calls that
buy or spend Tokens: `CharacterDAO.buyItem`, `buyPet`, `trainSkill`, `trainPetSkill`,
`instantTrainByToken`, `resetAPbyToken`, `saveResetAP`, `CharacterService.reviveBattleCharacter`,
and any name containing `.buy`, `purchase` or `ByToken`. With the bot stopped, manual purchases
work normally.

- `localStorage.nsServiceLog`: last 80 server calls (service names, bot running or not)
- `localStorage.nsBlockedCalls`: last 50 blocked calls
- `localStorage.nsServerLog`: last 40 calls with status, duration and game speed

### Site panels (Store etc.)

Stray clicks on in-game shop buttons call the site's `showPanel(...)` through ExternalInterface
and switch the tab to `/store` without a reload. While the bot runs, non-Play switches are
ignored (logged in `window.__nsBlockedPanels`); if the URL still drifts, the bot clicks the
site's PLAY link so the game comes back without a reload.

### Progress panel

- **Progress bar**: XP from where the current target was set to the target, plus the bar for the
  current level, the XP of the last mission and missions left (to the next level and to the
  target). Later levels are costed with the best mission they unlock.
- **XP per mission** is measured from HUD readings over every finished mission since an anchor
  (failed missions included), not from a single reading.
- **Time per mission** is the median gap between mission starts, per game speed.
- **Waste/mission**: missed attacks, Charge turns, failed enemy clicks, page arrow re-presses,
  missions that failed to open and time on unknown screens.
- **Steps**: time spent per step of the last mission; **Report slow** saves the current step
  with a screenshot to `localStorage.nsSlowReports`.

`__nsBot.report()` in the console returns all of the above as JSON (no images).

### Unknown screens

If the bot sits on a screen it does not recognise for more than 3 seconds, or right before an
error reload, a small screenshot is saved to `localStorage.nsBotUnknownScreens` (last 3, with
the reload reason and bot status).

### Jutsu cooldowns

The remaining turns show as a digit in the icon's bottom-right corner. The corner is recorded
when the jutsu fires (so it was ready); an icon whose corner differs is on cooldown and is not
clicked. Jutsu that are cooling down are retried 2 turns after firing, or 2/4/8 turns after
failing, so every jutsu keeps rotating in long boss fights. With chakra locked, **Attack** is the
fallback and **Charge** the last resort.

## Limits

- The game tab may stay in the background: while hidden, Ruffle frames and bot timers are driven
  by a Web Worker timer, which the browser does not throttle. Add `ninjasaga.cc` to the sites
  Memory Saver always keeps active, or the tab gets discarded. On macOS, App Nap can be turned
  off per browser with `defaults write com.brave.Browser NSAppSleepDisabled -bool YES`.
- Do not change the page zoom or resize the window drastically while the bot runs.
- Using bots or cheats breaks the server's rules and can get the account banned; use at your
  own risk.
