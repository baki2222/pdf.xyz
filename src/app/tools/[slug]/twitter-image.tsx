// Twitter/X card reuses the per-tool OpenGraph image so the two never drift apart.
import ToolOpengraphImage, {
  alt as openGraphAlt,
  contentType as openGraphContentType,
  generateStaticParams as openGraphStaticParams,
  size as openGraphSize,
} from "./opengraph-image";

export const runtime = "nodejs";
export const alt = openGraphAlt;
export const size = openGraphSize;
export const contentType = openGraphContentType;
export const generateStaticParams = openGraphStaticParams;
export const dynamicParams = false;

export default ToolOpengraphImage;
