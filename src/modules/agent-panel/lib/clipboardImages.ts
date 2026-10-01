const IMAGE_MIME_PREFIX = "image/";

export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files = Array.from(data.files).filter((file) =>
    file.type.startsWith(IMAGE_MIME_PREFIX),
  );
  if (files.length > 0) return files;

  return Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith(IMAGE_MIME_PREFIX)) {
      return [];
    }
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}
