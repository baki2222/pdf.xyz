// Twitter/X reuses this page's OpenGraph card so the two can never drift apart.
import PageOpengraphImage, {
  alt as openGraphAlt,
  contentType as openGraphContentType,
  size as openGraphSize,
} from "./opengraph-image";

export const runtime = "nodejs";
export const alt = openGraphAlt;
export const size = openGraphSize;
export const contentType = openGraphContentType;

export default PageOpengraphImage;
