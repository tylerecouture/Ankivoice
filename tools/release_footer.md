
---

### Installing

**New installs only:** import `AnkiVoice-test.apkg` on the phone to try it out,
then follow the [README](https://github.com/tylerecouture/Ankivoice#install) to
add the loader to your own note types.

**Updating an existing install:** do NOT rely on importing the `.apkg` to update.
Anki renames a colliding media file rather than overwriting it, so your old
script keeps running and nothing tells you.

1. Sync from AnkiDroid first, so the phone's changes are safely uploaded.
2. Sync from Anki Desktop.
3. Download `_ankivoice.js` onto your computer.
4. Overwrite the copy in your desktop `collection.media` folder.
5. Sync Anki Desktop.
6. Sync AnkiDroid to pull down the new file.

**Check which version is live:** the bar reads `AnkiVoice v<n>` before a card
starts, and the settings panel header shows it too.
