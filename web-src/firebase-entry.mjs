/** The ONLY Firebase SDK surface the page uses (Authentication with the Google provider). Bundled by
 *  scripts/build-vendor.mjs into web/vendor/firebase-auth.js, so the page loads nothing from a CDN (SPEC §7).
 *  No Firestore SDK: the page reads and writes ONLY through the controlled API. */
export { initializeApp } from '@firebase/app';
export {
  initializeAuth, connectAuthEmulator, browserSessionPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged,
} from '@firebase/auth';
