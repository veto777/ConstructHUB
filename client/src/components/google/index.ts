/**
 * Google-style building blocks. Tokens live in client/src/styles/google.css (imported once from
 * client/src/index.css); the signed-in platform layout (App.tsx) is a `.g-surface` with the brand orange as its
 * accent, the Google Business pages wrap in <GoogleSurface> for Google's blue.
 */
export { GoogleSurface } from "./GoogleSurface";
export { GoogleSectionHeader } from "./GoogleSectionHeader";
export { GooglePill } from "./GooglePill";
export { GoogleStars, GoogleStarRow, formatCount } from "./GoogleStars";
export { GoogleOpenStatus, openNowFromHours } from "./GoogleOpenStatus";
export { GoogleLocalCard, GoogleAvatar, highlightText } from "./GoogleLocalCard";
export type { GooglePhoto } from "./GoogleLocalCard";
export { GoogleListRow, GoogleList, GoogleMeta } from "./GoogleListRow";
export { GoogleStat, GoogleStatGrid } from "./GoogleStat";
export { GoogleMoreButton } from "./GoogleMoreButton";
export { GoogleAiOverview, AiEntity, SparkleIcon } from "./GoogleAiOverview";
export { relativeTime } from "./relative-time";
