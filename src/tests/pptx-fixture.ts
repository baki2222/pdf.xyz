/**
 * A PPTX built by hand, part by part — the powerpoint-to-pdf deployment proof's
 * input, and the independent POSITIVE CONTROL for `readPptx`
 * (`src/lib/workers/pdf-office-export/validate-ooxml.ts`).
 *
 * Moved here from `scripts/worker-prove-tools.ts` so the unit test and the
 * proof read the same deck. It is deliberately NOT built by the PDF to
 * PowerPoint writer (`pptx-package.ts`): a checker calibrated only against the
 * writer it checks can agree with that writer's mistakes. This deck opens in
 * PowerPoint (checked through its COM API, 2026-09-27) and in LibreOffice (the
 * powerpoint-to-pdf proof converts it on every run).
 */
import JSZip from "jszip";

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const ODOC_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const rootRels = (target: string, type: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${type}" Target="${target}"/></Relationships>`;

/** A real PPTX. PresentationML needs the whole master/layout/theme chain to open. */
export async function handBuiltPptx(): Promise<Buffer> {
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    rootRels("ppt/presentation.xml", `${ODOC_NS}/officeDocument`),
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
<p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${ODOC_NS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>
<Relationship Id="rId2" Type="${ODOC_NS}/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="${ODOC_NS}/theme" Target="theme/theme1.xml"/></Relationships>`,
  );

  const spTree = (title: string) => `<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="685800" y="2130425"/><a:ext cx="7772400" cy="1470025"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="3200"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree>`;

  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}"><p:cSld>${spTree("PowerPoint to PDF — pdf.xyz proof")}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    rootRels("../slideLayouts/slideLayout1.xml", `${ODOC_NS}/slideLayout`),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}" type="title"><p:cSld name="Title Slide">${spTree("")}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rootRels("../slideMasters/slideMaster1.xml", `${ODOC_NS}/slideMaster`),
  );

  const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${ODOC_NS}"><p:cSld>${spTree("")}</p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">
<Relationship Id="rId1" Type="${ODOC_NS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="${ODOC_NS}/theme" Target="../theme/theme1.xml"/></Relationships>`,
  );

  const clr = (tag: string, hex: string) =>
    `<a:${tag}><a:srgbClr val="${hex}"/></a:${tag}>`;
  const fnt = (tag: string) =>
    `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const styleList = (tag: string, inner: string) =>
    `<a:${tag}>${inner.repeat(3)}</a:${tag}>`;
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A}" name="Proof"><a:themeElements>
<a:clrScheme name="Proof">${clr("dk1", "000000")}${clr("lt1", "FFFFFF")}${clr("dk2", "1F497D")}${clr("lt2", "EEECE1")}${clr("accent1", "4F81BD")}${clr("accent2", "C0504D")}${clr("accent3", "9BBB59")}${clr("accent4", "8064A2")}${clr("accent5", "4BACC6")}${clr("accent6", "F79646")}${clr("hlink", "0000FF")}${clr("folHlink", "800080")}</a:clrScheme>
<a:fontScheme name="Proof">${fnt("majorFont")}${fnt("minorFont")}</a:fontScheme>
<a:fmtScheme name="Proof">
${styleList("fillStyleLst", `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`)}
${styleList("lnStyleLst", `<a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`)}
${styleList("effectStyleLst", `<a:effectStyle><a:effectLst/></a:effectStyle>`)}
${styleList("bgFillStyleLst", `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`)}
</a:fmtScheme></a:themeElements></a:theme>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
