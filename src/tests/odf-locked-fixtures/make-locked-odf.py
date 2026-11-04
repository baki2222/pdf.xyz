import time, uno
from com.sun.star.beans import PropertyValue
def P(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p
local = uno.getComponentContext()
resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
ctx = None
for _ in range(90):
    try:
        ctx = resolver.resolve("uno:pipe,name=lockp;urp;StarOffice.ComponentContext"); break
    except Exception:
        time.sleep(1)
desktop = ctx.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
jobs = [("odt", "private:factory/swriter", "writer8"),
        ("ods", "private:factory/scalc", "calc8"),
        ("odp", "private:factory/simpress", "impress8")]
for ext, url, filt in jobs:
    doc = desktop.loadComponentFromURL(url, "_blank", 0, (P("Hidden", True),))
    word = "LOCKED" + ext.upper()
    if ext == "odt":
        doc.Text.setString(word)
    elif ext == "ods":
        doc.Sheets.getByIndex(0).getCellByPosition(0, 0).setString(word)
    else:
        page = doc.DrawPages.getByIndex(0)
        shape = doc.createInstance("com.sun.star.drawing.TextShape")
        page.add(shape); shape.setString(word)
    # Locked with a password, and an unlocked twin from the same document.
    doc.storeToURL("file:///out/locked." + ext, (P("FilterName", filt), P("Password", "pdfxyz-fixture")))
    doc.storeToURL("file:///out/open." + ext, (P("FilterName", filt),))
    doc.close(True)
print("made")
