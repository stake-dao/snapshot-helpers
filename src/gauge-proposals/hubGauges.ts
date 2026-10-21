const VOTEMARKET_URL = 'https://hub.stakedao.org/v1/votemarket';

export async function fetchHubGauges(protocol: 'curve' | 'yb'): Promise<any[]> {
    const response = await fetch(`${VOTEMARKET_URL}/${protocol}/gauges`);
    if (!response.ok) throw new Error(`Failed to fetch ${protocol} gauges: ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.gauges) || data.gauges.length === 0) {
        throw new Error(`Invalid or empty ${protocol} gauge catalog`);
    }
    // Preserve ordering, root/child identities and integer strings. Each
    // proposal applies its own eligibility rules to this complete catalog.
    return data.gauges;
}
