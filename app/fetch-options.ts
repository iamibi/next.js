// One options object shared by every fetch, like options exported from an API
// client module.
export const fetchOptions: RequestInit = {
  next: { revalidate: 3600, tags: ["shared"] },
};
