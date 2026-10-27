// Jobs use the Data Hub worker; DATA_HUB_URL overrides its root URL.
export const getDataHubUrl = (path: string): string => {
    const baseUrl = process.env.DATA_HUB_URL || "https://data-hub.contact-69d.workers.dev";
    return `${baseUrl.replace(/\/+$/, "")}${path}`;
};
