// Jobs configure the Data Hub root URL through DATA_HUB_URL.
export const getDataHubUrl = (path: string): string => {
    const baseUrl = process.env.DATA_HUB_URL?.trim();
    if (!baseUrl) {
        throw new Error("DATA_HUB_URL must be set to the Data Hub root URL");
    }
    return `${baseUrl.replace(/\/+$/, "")}${path}`;
};
