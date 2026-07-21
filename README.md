# Riverwood Ecclesia Portal

A members-only web app for the Riverwood Christadelphian Ecclesia: sign in, read
ecclesia news (posted by admins), see your own upcoming roster duties, and
(if you're an admin) manage news, the duty roster, and member accounts.

Inspired by Ministry Scheduler Pro (MSP), styled to match riverwoodce.com.au.

## What's inside

- `server.js` / `db.js` - Node.js + Express backend, SQLite database (file-based,
  no separate database server to install), password hashing (bcrypt), file
  uploads (multer), and cookie-based login sessions (JWT).
- `public/` - the site itself: login page, news + "My Schedule" dashboard,
  a duty roster with calendar and list views, an uploaded-talks library, a
  member "My Availability & Preferences" page, and an admin page for
  managing members.
- `public/manifest.json` + `public/icons/` - a PWA manifest, so members can
  "Add to Home Screen" on their phone and it opens full-screen like an app.

Roles on the roster: Exhorter, Chairman, Reader/Emblem 1, Reader/Emblem 2,
AV/Music, Pianist, Doorman, Hosting, Hall Duties / Emblem Wash (Sunday
Memorial Meeting), Speaker (Sunday Evening Lecture), and Speaker, Chairman,
AV/Music, Pianist, Doorman, Supper (Wednesday Bible Class). "Add event" on the
Roster page has a Meeting Type dropdown that pre-fills the right roles, or you
can pick "Custom" for anything else.

Hosting, Hall Duties / Emblem Wash, and Supper are couple/pair duties, so
they're stored and edited as free text (e.g. "J+R Stone") rather than tied to
one login - every other role links to a real member account so it shows up
under that person's "My Schedule".

## Availability, duty preferences, and auto-fill

Every member has a **My Availability** page where they can:
- Mark date ranges they're unavailable (e.g. a holiday), with an optional reason.
- Tick which duties they're willing/able to do: Exhorter, Chairman,
  Reader/Emblem, AV/Music, Pianist, Doorman, Speaker. (Reader/Emblem 1 and 2
  are the same skill, so it's one checkbox covering both slots.)

Admins get an **Auto-fill unfilled duties** panel on the Roster page. Pick a
date range and it fills every currently-*empty* individual-linked slot in
that window, picking whoever is both available on that date and has opted
into that role, favouring whoever currently has the fewest duties overall so
it stays fair over time. A few deliberate rules worth knowing:

- It **never** touches a slot that's already filled - it only fills gaps, so
  you can always manually override anything by hand afterward and rerun it
  safely.
- It **never** assigns Hosting, Hall Duties / Emblem Wash, or Supper - those
  stay couple-based and manual, since they're not tied to one login.
- It **never** double-books the same person twice on the same event (e.g.
  Chairman and Doorman on the same Sunday).
- If nobody is both available and opted into a role for a given slot, it's
  left empty and listed in the "still need a volunteer" results so you know
  exactly who to chase - it will never force an assignment onto someone who
  hasn't opted in.
- A brand new member with no preferences set yet simply won't be picked for
  anything until they visit My Availability and tick at least one duty.

## Roster calendar view

The Roster page now defaults to a **month calendar** - each day shows small
coloured chips for what's on (Memorial Meeting, Evening Lecture, Bible Class,
or a custom event), and clicking a day expands the full roster for that date
below the calendar, exactly as before (editable inline if you're an admin).
Use **Prev / Next** to browse other months, or switch to the **List view**
toggle for the old scrollable view (handy for admins doing bulk edits, or for
the "Upcoming only / All" filter).

## Talks library

There's now a **Talks** page where admins can upload recordings (audio or
video, up to 150MB each - title, speaker, date and a short description are
optional except title). Everyone logged in can browse the list and play
recordings back in the browser, or download them.

**Important - same storage limitation as the database:** uploaded talk files
are saved next to the database (`uploads/talks/`), so on Render's **free**
tier they'll be wiped every time the service restarts, exactly like news
posts and roster changes. Once you upgrade to a paid plan and attach a
persistent disk (see "Making this live" below), uploaded talks will persist
too, using that same disk - just bear in mind audio/video files are much
bigger than the database, so bump `sizeGB` in `render.yaml` from 1GB to
something like 5-10GB if you plan to build up a library of recordings.

## Run it locally

Requires Node.js 18+ (https://nodejs.org).

```
cd riverwood-portal
npm install
npm start
```

Then open http://localhost:3000 in a browser. The first run seeds the
database (`data.sqlite`) from `data/seed-data.json` - **this is loaded with
your real July-December 2026 Speaking List**: all 123 individuals from the
Members Contact Details directory, and all 59 Sunday Memorial Meetings,
Sunday Evening Lectures and Wednesday Bible Classes with their real duty
assignments. Startup takes 10-15 seconds the first time while it hashes
everyone's password - that's normal, not a hang.

- **Every real member's temporary password:** `Riverwood2026!` (they should
  change it, or you can reset anyone's password from the Admin page any time).
- **Admins:** Micah Dodson and Garrick Shaw (your Recorder) were set as
  admins since you're building this and he maintains the speaking list in
  real life - change this on the Admin page if you'd rather it be someone
  else. A fallback generic login also exists in case you get locked out:
  admin@riverwoodce.org.au / ChangeMe123!
- **Login emails:** most match the Members Contact Details sheet exactly.
  Where a household shared one email between two people (e.g. a Bro & Sis
  with only one listed address), I generated a unique login by appending
  their first name to it (e.g. `dpgilham+micah@iinet.net.au`) so each person
  can have their own account - swap these for real individual addresses as
  you learn them, from the Admin page (edit isn't wired up for email yet, so
  for now that means: remove and re-add that person with the corrected
  email). A handful of people had no email at all on file - they were given a
  placeholder `@riverwoodce.local` address purely so they have a login; give
  them a real one when you have it.
- **The 6 items flagged in the speaking-list review page** (`speaking-list.html`)
  were carried through as-is (e.g. "Jeremy Garden" the doorman, and the
  Combined Weekend date conflict) - fix those in the Roster page once you've
  confirmed the right answer with your recorder.

## Design notes

The visual style (deep maroon + gold on cream, a Bible verse hero banner,
warm community language) is inspired by riverwoodce.com.au's tone and content
- I couldn't pull their exact brand colours/logo file from a text-based fetch,
  so the palette here is a close, tasteful approximation. Swap in the real
  logo and exact hex values in `public/css/style.css` (the `:root` variables
  at the top) any time you have them.

## A note on privacy

`data/seed-data.json` and the running database now contain real names, emails,
phone numbers and home addresses for your ecclesia. Treat this folder like the
printed speaking list booklet: fine to use internally, but don't publish the
zip file, the JSON, or the database anywhere public, and make sure whichever
hosting option you choose (see below) isn't publicly listable. `speaking-list.html`
is a plain read-only page with no login - anyone with the link can view it, so
keep that link to yourselves too until this is finished and put behind the
real login system.

## Making this "live" for the whole ecclesia

**Important: this is not a static site, so it cannot go on Netlify, GitHub
Pages, or similar.** Those only serve plain HTML/CSS/JS files - they can't run
the Node.js server that handles login, the news feed, or the roster (that's
why you'll get a "Page not found" error if you try). It needs a host that
runs a real Node.js process. Render.com is the easiest fit and has a free
tier, and a `render.yaml` file is already included so it can pick up the
right settings automatically.

**Deploying to Render (step by step):**

1. **Put the code on GitHub.** Create a free GitHub account if you don't have
   one, create a new repository (e.g. "riverwood-portal"), and upload every
   file in this `riverwood-portal` folder to it (GitHub's web uploader works
   fine - drag the files in, or use GitHub Desktop if you'd rather not use
   the command line).
2. **Sign up at render.com** (free) and choose **New > Blueprint**.
3. Connect your GitHub account and select the repository you just created.
   Render will read `render.yaml` and pre-fill everything: a free web
   service and a random `JWT_SECRET`. Click **Apply** / **Deploy**.
4. First deploy takes a few minutes (and the very first page load after that
   will take ~15 seconds while it seeds 123 real accounts - that's normal).
   Once it's live, Render gives you a URL like
   `https://riverwood-portal.onrender.com` - that's the real site everyone
   can log into.
5. **Optional - use your own domain** (e.g. `portal.riverwoodce.com.au`):
   in Render, go to the service's Settings > Custom Domain, and follow its
   instructions to point a DNS record at it. Free tier includes HTTPS
   automatically either way.

**Important limitation on the free tier:** Render's free web services don't
support a persistent disk, and they spin down after ~15 minutes of no
traffic. Every time it spins back up, the database reseeds from scratch -
meaning any news posts, roster reassignments, or added members an admin makes
get wiped. This is fine for testing and showing people the real site, but
**before this becomes the actual day-to-day site**, upgrade the service to a
paid Starter plan (~US$7/month, in Render's dashboard under the service's
Settings) and add a persistent disk back into `render.yaml`:

```yaml
    disk:
      name: riverwood-data
      mountPath: /opt/render/project/src/data-disk
      sizeGB: 5   # bump higher if you upload lots of talk recordings
    envVars:
      - key: JWT_SECRET
        generateValue: true
      - key: DB_DIR
        value: /opt/render/project/src/data-disk
```

(`db.js` already reads `DB_DIR` if it's set, so no code changes are needed -
just add this back to `render.yaml`, commit, and Render will redeploy with
the disk attached.)

If you outgrow SQLite down the track (say, hundreds of concurrent users),
swapping to a hosted Postgres (e.g. via Supabase, or Render's own Postgres
add-on) is a moderate change to `db.js` - not something you need to worry
about at ecclesia scale.

## Turning this into a mobile app later

- **Right now:** because of the manifest and icons already included, members
  can open the site in their phone browser and choose "Add to Home Screen" -
  it behaves like an installed app (own icon, no browser bar).
- **Later, a true app-store app:** once the web version is solid, a tool like
  Capacitor (https://capacitorjs.com) can wrap this same site into an actual
  iOS/Android app with almost no rewrite, or a React Native app can be built
  against the same backend API if you want a fully native feel.
