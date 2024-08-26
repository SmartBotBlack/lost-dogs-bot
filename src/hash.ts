type OutputFormat = "hex" | "buffer";

interface HashOptions {
	outputFormat?: OutputFormat;
}

const createHashFunction = (algorithm = "SHA-256") => {
	return async (
		input: string | ArrayBuffer,
		options: HashOptions = {},
	): Promise<string | ArrayBuffer> => {
		const { outputFormat = "hex" } = options;

		let data: Uint8Array | ArrayBuffer;
		if (typeof input === "string") {
			data = new TextEncoder().encode(input);
		} else {
			data = input;
		}

		const hashBuffer = await crypto.subtle.digest(algorithm, data);

		if (outputFormat === "hex") {
			return bufferToHex(hashBuffer);
		}

		return hashBuffer;
	};
};

const bufferToHex = (buffer: ArrayBuffer): string => {
	const view = new DataView(buffer);
	let hexString = "";
	for (let i = 0; i < view.byteLength; i += 4) {
		hexString += view.getUint32(i).toString(16).padStart(8, "0");
	}
	return hexString;
};

export default createHashFunction();
