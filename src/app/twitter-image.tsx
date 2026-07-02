// Twitter/X card reuses the OpenGraph image so the two never drift apart.
import OpengraphImage, {
  alt as openGraphAlt,
  contentType as openGraphContentType,
  size as openGraphSize,
} from "./opengraph-image";

export const runtime = "nodejs";
export const alt = openGraphAlt;
export const size = openGraphSize;
export const contentType = openGraphContentType;

export default OpengraphImage;
