/**
 * Two encrypted PDFs that differ in exactly the property the engine has to
 * tell apart — whether the file OPENS without a password.
 *
 *  - OWNER-ONLY ("permissions") encryption: an /Encrypt dictionary with an
 *    EMPTY user password and a non-empty owner password. Every viewer opens it
 *    with no prompt; it only restricts editing/printing. This is what bank
 *    statements, e-invoices and many government forms carry.
 *  - USER-PASSWORD encryption: the same file, but it cannot be opened at all
 *    without the password.
 *
 * pdf-lib refuses BOTH identically (`EncryptedPDFError` for any /Encrypt), which
 * is how the owner-only file came to be told it was "password-protected".
 * pdf-lib cannot write encryption, so these were produced once with pypdf 6.19.0
 * (RC4-128, no object streams) and checked in:
 *
 *     w = PdfWriter(); three 200x200 pages drawing OWNER-P1..3 in Helvetica,
 *     page 2 rotated 90; w.encrypt(user_password="" | "open-sesame",
 *     owner_password="owner-secret", algorithm="RC4-128"); w.write(...)
 *
 * The owner-only file's page 2 carries /Rotate 90 so a reader that "succeeds"
 * without really parsing the page tree (e.g. pdf-lib with ignoreEncryption on
 * an encrypted object stream) cannot pass by returning zeros.
 */
export const ENCRYPTED_FIXTURE_TEXT = ["OWNER-P1", "OWNER-P2", "OWNER-P3"];
export const ENCRYPTED_FIXTURE_ROTATIONS = [0, 90, 0];

export const OWNER_ONLY_PDF_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDZhMDJiODc4NWM+Cj4+CmVu" +
  "ZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMwovS2lkcyBbIDQgMCBSIDcg" +
  "MCBSIDEwIDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdl" +
  "cyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8" +
  "Ci9Gb250IDw8Ci9GMSA2IDAgUgo+Pgo+PgovTWVkaWFCb3ggWyAwLjAgMC4wIDIwMCAyMDAg" +
  "XQovUGFyZW50IDIgMCBSCi9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAov" +
  "TGVuZ3RoIDM5Cj4+CnN0cmVhbQrX8YCU5hNALvuCIjuRYtXJxlWh5OYSqXRp7iqwAybvW/zE" +
  "ml9phgAKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBl" +
  "IC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQo+PgplbmRvYmoKNyAwIG9iago8PAovVHlw" +
  "ZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA5IDAgUgo+Pgo+PgovTWVkaWFC" +
  "b3ggWyAwLjAgMC4wIDIwMCAyMDAgXQovUGFyZW50IDIgMCBSCi9Db250ZW50cyA4IDAgUgov" +
  "Um90YXRlIDkwCj4+CmVuZG9iago4IDAgb2JqCjw8Ci9MZW5ndGggMzkKPj4Kc3RyZWFtCjCK" +
  "lJJ4H/W+ezorJbTWnZP4ybybZ5pnfd8EIr5SOhpeLrF+uoNybQplbmRzdHJlYW0KZW5kb2Jq" +
  "CjkgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVs" +
  "dmV0aWNhCj4+CmVuZG9iagoxMCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8" +
  "Ci9Gb250IDw8Ci9GMSAxMiAwIFIKPj4KPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAw" +
  "IF0KL1BhcmVudCAyIDAgUgovQ29udGVudHMgMTEgMCBSCj4+CmVuZG9iagoxMSAwIG9iago8" +
  "PAovTGVuZ3RoIDM5Cj4+CnN0cmVhbQr1UmczJpXjueKIPPaURVH8AGfEIno+U8Ixg4XV8LkN" +
  "vQutSO0d0zIKZW5kc3RyZWFtCmVuZG9iagoxMiAwIG9iago8PAovVHlwZSAvRm9udAovU3Vi" +
  "dHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjEzIDAgb2JqCjw8" +
  "Ci9WIDIKL1IgMwovTGVuZ3RoIDEyOAovUCA0Mjk0OTYzMzk2Ci9GaWx0ZXIgL1N0YW5kYXJk" +
  "Ci9PIDw5MTNiMDczZjViNjU5NTRjOGI2ZGEyMjE2OTk3MWExNzdiN2U2ZDk0YTEwNmZmNzVj" +
  "MGMxNjI5NmJjMTU0MTJlPgovVSA8N2JiZDllOGQyYzU4NDhlZTEzNWI5ZjFiNzFkZjQ1ZWYy" +
  "OGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KPj4KZW5kb2JqCnhyZWYKMCAxNAow" +
  "MDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAw" +
  "MCBuIAowMDAwMDAwMTMxIDAwMDAwIG4gCjAwMDAwMDAxODAgMDAwMDAgbiAKMDAwMDAwMDMx" +
  "MiAwMDAwMCBuIAowMDAwMDAwNDAxIDAwMDAwIG4gCjAwMDAwMDA0NzEgMDAwMDAgbiAKMDAw" +
  "MDAwMDYxNCAwMDAwMCBuIAowMDAwMDAwNzAzIDAwMDAwIG4gCjAwMDAwMDA3NzMgMDAwMDAg" +
  "biAKMDAwMDAwMDkwOCAwMDAwMCBuIAowMDAwMDAwOTk4IDAwMDAwIG4gCjAwMDAwMDEwNjkg" +
  "MDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSAxNAovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgov" +
  "SUQgWyA8MzEzMjM5NjUzNzM3NjY2NjM1MzY2MTM3NjEzNjMxNjI2NjM3NjQzNDY0NjIzOTYy" +
  "MzIzNjY0Mzc2NjM2NjEzNT4gPDMxMzIzOTY1MzczNzY2NjYzNTM2NjEzNzYxMzYzMTYyNjYz" +
  "NzY0MzQ2NDYyMzk2MjMyMzY2NDM3NjYzNjYxMzU+IF0KL0VuY3J5cHQgMTMgMCBSCj4+CnN0" +
  "YXJ0eHJlZgoxMjg1CiUlRU9GCg==";

export const USER_PASSWORD_PDF_BASE64 =
  "JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPGRhZDJjMDcxYjU+Cj4+CmVu" +
  "ZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMwovS2lkcyBbIDQgMCBSIDcg" +
  "MCBSIDEwIDAgUiBdCj4+CmVuZG9iagozIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdl" +
  "cyAyIDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8" +
  "Ci9Gb250IDw8Ci9GMSA2IDAgUgo+Pgo+PgovTWVkaWFCb3ggWyAwLjAgMC4wIDIwMCAyMDAg" +
  "XQovUGFyZW50IDIgMCBSCi9Db250ZW50cyA1IDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAov" +
  "TGVuZ3RoIDM5Cj4+CnN0cmVhbQpeQdebI7lnCygelko6hSiscyp3i7JV82kUhnFW2ZMpqlIi" +
  "RQJbB8sKZW5kc3RyZWFtCmVuZG9iago2IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBl" +
  "IC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQo+PgplbmRvYmoKNyAwIG9iago8PAovVHlw" +
  "ZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA5IDAgUgo+Pgo+PgovTWVkaWFC" +
  "b3ggWyAwLjAgMC4wIDIwMCAyMDAgXQovUGFyZW50IDIgMCBSCi9Db250ZW50cyA4IDAgUgov" +
  "Um90YXRlIDkwCj4+CmVuZG9iago4IDAgb2JqCjw8Ci9MZW5ndGggMzkKPj4Kc3RyZWFtCqH2" +
  "heYKzX2G5O+hr4kmgjTQe2su2LqNuV+w0Kyy6/9wrCR7/XbTYAplbmRzdHJlYW0KZW5kb2Jq" +
  "CjkgMCBvYmoKPDwKL1R5cGUgL0ZvbnQKL1N1YnR5cGUgL1R5cGUxCi9CYXNlRm9udCAvSGVs" +
  "dmV0aWNhCj4+CmVuZG9iagoxMCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8" +
  "Ci9Gb250IDw8Ci9GMSAxMiAwIFIKPj4KPj4KL01lZGlhQm94IFsgMC4wIDAuMCAyMDAgMjAw" +
  "IF0KL1BhcmVudCAyIDAgUgovQ29udGVudHMgMTEgMCBSCj4+CmVuZG9iagoxMSAwIG9iago8" +
  "PAovTGVuZ3RoIDM5Cj4+CnN0cmVhbQq9zb6OSuoDw06QO2TEg5Co8Fz6r4AHYpfokL5y9HwD" +
  "OFAdoLEnBy0KZW5kc3RyZWFtCmVuZG9iagoxMiAwIG9iago8PAovVHlwZSAvRm9udAovU3Vi" +
  "dHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCjEzIDAgb2JqCjw8" +
  "Ci9WIDIKL1IgMwovTGVuZ3RoIDEyOAovUCA0Mjk0OTYzMzk2Ci9GaWx0ZXIgL1N0YW5kYXJk" +
  "Ci9PIDxkNmY0MmMwZjM4NjM3YTdlOGUwMDg5NWYyOTIzNDU1MTIwZGEyYzQ2NzEyMDk3MGEx" +
  "NWNjYzM0NmY2NDY5ZTg0PgovVSA8YjZkNDgwNGJhZDI3YzNlNTMyM2VlMGJhZWYwZGI5Mjgy" +
  "OGJmNGU1ZTRlNzU4YTQxNjQwMDRlNTZmZmZhMDEwOD4KPj4KZW5kb2JqCnhyZWYKMCAxNAow" +
  "MDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAw" +
  "MCBuIAowMDAwMDAwMTMxIDAwMDAwIG4gCjAwMDAwMDAxODAgMDAwMDAgbiAKMDAwMDAwMDMx" +
  "MiAwMDAwMCBuIAowMDAwMDAwNDAxIDAwMDAwIG4gCjAwMDAwMDA0NzEgMDAwMDAgbiAKMDAw" +
  "MDAwMDYxNCAwMDAwMCBuIAowMDAwMDAwNzAzIDAwMDAwIG4gCjAwMDAwMDA3NzMgMDAwMDAg" +
  "biAKMDAwMDAwMDkwOCAwMDAwMCBuIAowMDAwMDAwOTk4IDAwMDAwIG4gCjAwMDAwMDEwNjkg" +
  "MDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSAxNAovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgov" +
  "SUQgWyA8MzEzMjM5NjUzNzM3NjY2NjM1MzY2MTM3NjEzNjMxNjI2NjM3NjQzNDY0NjIzOTYy" +
  "MzIzNjY0Mzc2NjM2NjEzNT4gPDMxMzIzOTY1MzczNzY2NjYzNTM2NjEzNzYxMzYzMTYyNjYz" +
  "NzY0MzQ2NDYyMzk2MjMyMzY2NDM3NjYzNjYxMzU+IF0KL0VuY3J5cHQgMTMgMCBSCj4+CnN0" +
  "YXJ0eHJlZgoxMjg1CiUlRU9GCg==";
