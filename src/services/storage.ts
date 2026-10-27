/**
 * Firebase Storage helpers with client-side validation and progress reporting.
 *
 * Storage layout (enforced by storage.rules):
 *   avatars/{uid}/{file}              profile pictures      (images, <= 5 MB)
 *   covers/{uid}/{file}               profile banners       (images, <= 8 MB)
 *   posts/{uid}/{postId}/{file}       community attachments (images, <= 8 MB)
 *   chat/{conversationId}/{file}      chat attachments      (images/pdf, <= 10 MB)
 *   groups/{groupId}/{file}           shared group files    (images/pdf, <= 15 MB)
 *   tutor-proofs/{uid}/{file}         degree proof uploads  (images/pdf, <= 10 MB; owner + admin only)
 */
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
  type UploadTaskSnapshot,
} from "firebase/storage";
import { storage } from "@/integrations/firebase/client";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const DOC_TYPES = [...IMAGE_TYPES, "application/pdf"];

export interface UploadOptions {
  /** Full storage path *without* the file name, e.g. `avatars/${uid}` */
  folder: string;
  file: File | Blob;
  /** Original file name (needed for Blobs). */
  fileName?: string;
  maxBytes?: number;
  allowedTypes?: string[];
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  url: string;
  path: string;
  contentType: string;
  size: number;
  name: string;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "file";
}

export async function uploadFile(opts: UploadOptions): Promise<UploadResult> {
  const { folder, file, maxBytes = 10 * 1024 * 1024, allowedTypes = DOC_TYPES, onProgress } = opts;
  const name = sanitizeName(opts.fileName || (file instanceof File ? file.name : "upload"));
  const contentType = file.type || "application/octet-stream";

  if (!allowedTypes.includes(contentType)) {
    throw new Error("That file type isn't supported.");
  }
  if (file.size > maxBytes) {
    throw new Error(`File is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }

  const path = `${folder}/${Date.now()}-${name}`;
  const task = uploadBytesResumable(storageRef(storage, path), file, { contentType });

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap: UploadTaskSnapshot) => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      () => resolve(),
    );
  });

  const url = await getDownloadURL(task.snapshot.ref);
  return { url, path, contentType, size: file.size, name };
}

/** Delete a file given its download URL or storage path. Missing files are ignored. */
export async function deleteStoredFile(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;
  // Only touch objects in our own bucket — never try to delete external avatar URLs.
  if (/^https?:\/\//.test(urlOrPath) && !urlOrPath.includes("firebasestorage.googleapis.com")) return;
  try {
    await deleteObject(storageRef(storage, urlOrPath));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "storage/object-not-found") console.warn("deleteStoredFile failed:", err);
  }
}
