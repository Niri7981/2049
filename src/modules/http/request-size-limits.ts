export const MAX_LOCAL_REQUEST_BYTES = 8 * 1024;
export const MAX_RESOURCE_BODY_BYTES = 16 * 1024;
// A JSON envelope may escape each Resource-body byte as six ASCII bytes.
// Keep room for bounded Resource metadata and validated query fields as well.
export const MAX_RESOURCE_ENTRY_BYTES = 128 * 1024;
