interface MultipartFile {
  fieldName: string;
  filename: string;
  contentType: string;
  content: Buffer | string;
}

interface MultipartPayloadOptions {
  fields: Record<string, string>;
  file?: MultipartFile;
  fileFirst?: boolean;
}

export async function multipartPayload(options: MultipartPayloadOptions) {
  const form = new FormData();

  const appendFields = () => {
    for (const [key, value] of Object.entries(options.fields)) {
      form.append(key, value);
    }
  };

  const appendFile = () => {
    if (!options.file) {
      return;
    }

    form.append(
      options.file.fieldName,
      new Blob([options.file.content], { type: options.file.contentType }),
      options.file.filename
    );
  };

  if (options.fileFirst) {
    appendFile();
    appendFields();
  } else {
    appendFields();
    appendFile();
  }

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
