// The app was renamed from "course-viewer" to "youtube-course-viewer". This
// runs before first paint (see app/layout.tsx) and moves saved browser data
// (theme, progress, cached library, session hint) to the new names before
// anything reads it. It also drops settings no code reads any more, such as
// the old custom player's speed.
export const STORAGE_MIGRATION_SCRIPT = `try {
  ["playback-rate", "notes-open", "notes-open-v2", "channel-avatars", "descriptions-v1"].forEach(function (name) {
    localStorage.removeItem("youtube-course-viewer-" + name);
  });
  var oldPrefix = "course-viewer-";
  var newPrefix = "youtube-course-viewer-";
  [localStorage, sessionStorage].forEach(function (store) {
    var keys = [];
    for (var i = 0; i < store.length; i++) {
      var key = store.key(i);
      if (key && key.indexOf(oldPrefix) === 0) keys.push(key);
    }
    keys.forEach(function (key) {
      var next = newPrefix + key.slice(oldPrefix.length);
      if (store.getItem(next) === null) store.setItem(next, store.getItem(key));
      store.removeItem(key);
    });
  });
  var hint = document.cookie.match(/(?:^|; )course-viewer-session=([^;]*)/);
  if (hint) {
    if (!/(?:^|; )youtube-course-viewer-session=/.test(document.cookie)) {
      document.cookie = "youtube-course-viewer-session=" + hint[1] + "; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    }
    document.cookie = "course-viewer-session=; Path=/; Max-Age=0; SameSite=Lax";
  }
} catch {}`;
