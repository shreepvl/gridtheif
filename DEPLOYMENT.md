# Deploying Grid Thief on Netlify (100% Free Forever)

Grid Thief has been refactored into a high-performance, zero-server architecture powered by **WebRTC DataChannels** (via PeerJS) and local browser execution.

- **No backend servers required** (no Render.com, no Railway, no paid dynos).
- **100% Free Forever on Netlify** (runs entirely as a modern static web application).
- **Zero latency P2P multiplayer** (<20ms direct peer-to-peer data channels).
- **Solo & Practice Mode** with intelligent AI bots built right in.

---

## Option 1: Deploy with Netlify Git Integration (Recommended)

1. Push this folder to a GitHub, GitLab, or Bitbucket repository.
2. In [Netlify Dashboard](https://app.netlify.com/), click **"Add new site"** &rarr; **"Import an existing project"**.
3. Select your repository.
4. Netlify automatically detects `netlify.toml`:
   - **Publish directory:** `public`
   - **Build command:** (leave empty or default)
5. Click **Deploy Site**.
6. Your game is immediately live at `https://<your-site-name>.netlify.app`!

---

## Option 2: Deploy with Netlify CLI

If you have the Netlify CLI installed:

```bash
# Login to Netlify (first time only)
npx netlify login

# Deploy directly to production
npx netlify deploy --prod --dir=public
```

---

## Option 3: Netlify Drag & Drop

1. Open [Netlify Drop](https://app.netlify.com/drop).
2. Drag the `public/` directory and drop it into the upload box.
3. Your game is live in seconds with a custom URL!

---

## How Real-Time Multiplayer Works Without a Server

1. **Host Operative:** When a player clicks *"Create Multiplayer Room"*, the browser generates a 4-letter room code (e.g. `NEON`) and registers as an authoritative WebRTC host through the free, global PeerJS STUN broker.
2. **Joining Players:** Other players enter the room code or open the shareable invite link (`https://your-site.netlify.app/?room=NEON`).
3. **P2P DataChannel:** A direct, encrypted WebRTC DataChannel connects all players. Game inputs, moves, dashes, and state synchronization travel directly between browsers with minimal latency.
4. **Solo vs Bots:** Players can also click *"Play Solo Match (vs Bots)"* to instantly battle up to 3 smart cyber-thief AI bots with zero network dependency.
