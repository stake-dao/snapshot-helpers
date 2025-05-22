export interface Proposal {
    id: string;
    title: string;
    body: string;
    choices: string[];
    start: number;
    end: number;
    snapshot: string;
    state: string;
    author: string;
    created: number;
    type: string;
    scores: number[];
    quorum: number;
    network: string;
    space: {
        id: string;
        name: string;
        symbol: string;
    };
}

export interface GraphQLResponse {
    proposals: Proposal[];
}