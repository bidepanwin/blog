export interface PostCover {
	id: string;
	file: string;
	alt: string;
	themes: string[];
	sourceSite: string;
	sourceUrl: string;
	author: string;
	authorization: string;
}

export type PostCoverAssignments = Record<string, string>;
