# Video sessions

Booked sessions (1:1 video, mock interviews, resume reviews) use a `VideoProvider` (`apps/api/src/lib/video.ts`).

## How a session gets a room

- Each booking gets a random room name with 160 bits of entropy (`mentor-<32 base32 chars>`). Rescheduling replaces it, so old links stop pointing at the session.
- `POST /api/v1/bookings/:id/join` returns the link only to the mentor and the mentee, and only from 10 minutes before the start until 15 minutes after the end.
- Calendar files (`.ics`) never contain the link.

## Providers

| `VIDEO_PROVIDER`  | What happens                                                                        |
| ----------------- | ----------------------------------------------------------------------------------- |
| `jitsi` (default) | Jitsi Meet at `JITSI_BASE_URL` (default `https://meet.jit.si`), opened in a new tab |
| `100ms`, `daily`  | Stub adapters: joining reports that video isn't set up yet                          |

### Local development: public meet.jit.si

Works out of the box and costs nothing. Two limits apply:

- meet.jit.si does not accept our tokens, so a link that leaks keeps working for that room. We reduce the exposure by handing links out only during the join window, to the two participants.
- Its terms restrict embedding to short demos, so the app opens the call in a new tab instead of an iframe.

### Production: self-hosted Jitsi with JWT

1. Run [docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet) (free, Apache-2.0) on your domain, with `ENABLE_AUTH=1` and `AUTH_TYPE=jwt`, and set its `JWT_APP_ID` and `JWT_APP_SECRET`.
2. Set the API env:

   ```bash
   VIDEO_PROVIDER=jitsi
   JITSI_BASE_URL=https://meet.your-college.example
   JITSI_APP_ID=<same as JWT_APP_ID>
   JITSI_APP_SECRET=<same as JWT_APP_SECRET, 32+ characters>
   ```

3. Join links now carry a JWT (`aud: jitsi`, `room`, `nbf` and `exp` equal to the join window; the mentor is a moderator). A leaked link stops working when the window closes.

Keep the Jitsi server in the same region as the rest of the deployment (India; see the deployment docs in Phase 8).

### Adding 100ms or Daily

Implement `VideoProvider.newRoom()` and `joinUrl()` against the provider's room and token APIs. Put all calls through the SSRF-safe fetcher with the provider's hosts allowlisted, and keep tokens short-lived (the join window). Credentials come from env.
