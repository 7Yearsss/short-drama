interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  content: Buffer | string;
}

interface MultipartPayloadOptions {
  fields: Record<string, string>;
  file: MultipartFile;
}

export async function multipartPayload(options: MultipartPayloadOptions) {
  const form = new FormData();
  for (const [key, value] of Object.entries(options.fields)) {
    form.append(key, value);
  }

  form.append(
    options.file.fieldName,
    new Blob([options.file.content], { type: options.file.contentType }),
    options.file.filename
  );

  const response = new Response(form);
  const contentType = response.headers.get('content-type');
  if (!contentType) {
    throw new Error('Missing multipart content-type');
  }

  return {
    headers: { 'content-type': contentType },
    payload: Buffer.from(await response.arrayBuffer()),
  };
}
