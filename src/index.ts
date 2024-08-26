import axios from "axios";
import "colors";
import { input, select } from "@inquirer/prompts";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import Database from "better-sqlite3";
import env from "./env";
import { HttpsProxyAgent } from "https-proxy-agent";
import createHash from "./hash";
const db = new Database("accounts.db");

const ensureTableExists = () => {
	const tableExists = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='accounts';",
		)
		.get();

	if (!tableExists) {
		db.prepare(`
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phoneNumber TEXT,
                session TEXT,
                proxy TEXT
            );
        `).run();
	}
};

const _headers = {
	accept: "*/*",
	"accept-encoding": "gzip, deflate, br, zstd",
	"accept-language": "en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7",
	"cache-control": "no-cache",
	"content-type": "application/json",
	origin: "https://dog-ways.newcoolproject.io",
	pragma: "no-cache",
	priority: "u=1, i",
	referer: "https://dog-ways.newcoolproject.io/",
	"sec-ch-ua":
		'"Not/A)Brand";v="8", "Chromium";v="126", "Mobile Safari";v="605.1.15"',

	"Sec-Ch-Ua-Mobile": "?1",
	"Sec-Ch-Ua-Platform": '"iOS"',
	"sec-fetch-dest": "empty",
	"sec-fetch-mode": "cors",
	"sec-fetch-site": "cross-site",
	"User-Agent":
		"Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
	"x-gg-client": "v:1 l:en",
};

const createSession = async (phoneNumber: string, proxy: string) => {
	try {
		const client = new TelegramClient(
			new StringSession(""),
			env.APP_ID,
			env.API_HASH,
			{
				deviceModel: env.DEVICE_MODEL,
				connectionRetries: 5,
			},
		);

		await client.start({
			phoneNumber: async () => phoneNumber,
			password: async () => await input({ message: "Enter your password:" }),
			phoneCode: async () =>
				await input({ message: "Enter the code you received:" }),
			onError: (err: Error) => {
				if (
					!err.message.includes("TIMEOUT") &&
					!err.message.includes("CastError")
				) {
					console.log(`Telegram authentication error: ${err.message}`.red);
				}
			},
		});

		console.log("Successfully created a new session!".green);
		const stringSession = client.session.save() as unknown as string;

		db.prepare(
			"INSERT INTO accounts (phoneNumber, session, proxy) VALUES (@phoneNumber, @session, @proxy)",
		).run({ phoneNumber, session: stringSession, proxy });

		await client.sendMessage("me", {
			message: "Successfully created a new session!",
		});
		console.log("Saved the new session to session file.".green);
		await client.disconnect();
		await client.destroy();
	} catch (e) {
		const error = e as Error;
		if (
			!error.message.includes("TIMEOUT") &&
			!error.message.includes("CastError")
		) {
			console.log(`Error: ${error.message}`.red);
		}
	}
};

const showAllAccounts = () => {
	const stmt = db.prepare("SELECT phoneNumber, proxy FROM accounts");
	for (const row of stmt.iterate()) {
		console.log(row);
	}
};

const getQueryId = async (phoneNumber: string, session: string) => {
	const client = new TelegramClient(
		new StringSession(session),
		env.APP_ID,
		env.API_HASH,
		{
			deviceModel: env.DEVICE_MODEL,
			connectionRetries: 5,
		},
	);

	await client.start({
		phoneNumber: async () => phoneNumber,
		password: async () => await input({ message: "Enter your password:" }),
		phoneCode: async () =>
			await input({ message: "Enter the code you received:" }),
		onError: (err: Error) => {
			if (
				!err.message.includes("TIMEOUT") &&
				!err.message.includes("CastError")
			) {
				console.log(`Telegram authentication error: ${err.message}`.red);
			}
		},
	});

	try {
		const peer = await client.getInputEntity("lost_dogs_bot");
		if (!peer) {
			console.log("Failed to get peer entity.".red);
			return;
		}
		const webview = await client.invoke(
			new Api.messages.RequestWebView({
				peer,
				bot: peer,
				fromBotMenu: false,
				platform: "ios",
				url: "https://dog-ways.newcoolproject.io/",
			}),
		);
		if (!webview || !webview.url) {
			console.log("Failed to get webview URL.".red);
			return;
		}
		const query = decodeURIComponent(
			webview.url.split("&tgWebAppVersion=")[0].split("#tgWebAppData=")[1],
		);

		return query;
	} catch (e) {
		console.log(`Error retrieving query data: ${(e as Error).message}`.red);
	} finally {
		await client.disconnect();
		await client.destroy();
	}
};

const getRandomInt = (min: number, max: number) =>
	Math.floor(Math.random() * (max - min + 1)) + min;

const extractUserData = (queryId: string) => {
	const urlParams = new URLSearchParams(queryId);
	const user = JSON.parse(decodeURIComponent(urlParams.get("user") ?? ""));
	return {
		extUserId: user.id,
		extUserName: user.username,
	};
};

const vote = async (
	prefix: string,
	queryId: string,
	proxy: string,
	value: number,
) => {
	const url = "https://api.getgems.io/graphql";
	const headers = {
		..._headers,
		"x-auth-token": queryId,
	};
	const payload = {
		operationName: "lostDogsWayVote",
		variables: { value: value.toString() },
		extensions: {
			persistedQuery: {
				version: 1,
				sha256Hash:
					"6fc1d24c3d91a69ebf7467ebbed43c8837f3d0057a624cdb371786477c12dc2f",
			},
		},
	};

	try {
		const response = await axios.post(
			url,
			payload,
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);
		const data = response.data.data.lostDogsWayVote;
		console.log(
			prefix,
			`${"Voted the card".green} ${data.selectedRoundCardValue}`,
			`${"Number of bones voted:".green} ${data.spentGameDogsCount}`,
		);
	} catch (e) {
		const error = e as Error;
		throw new Error(`vote failed: ${error.message}`);
	}
};

const getData = async (prefix: string, queryId: string, proxy: string) => {
	const hash = await createHash(
		"query getHomePage {\n  lostDogsWayUserInfo {\n    ...lostDogsWayUserInfoResponse\n    __typename\n  }\n  lostDogsWayGameStatus {\n    ...lostDogsWayGameStatusResponse\n    __typename\n  }\n}\n\nfragment lostDogsWayCurrentRoundVote on LostDogsWayCurrentRoundVote {\n  __typename\n  id\n  selectedRoundCardValue\n  spentGameDogsCount\n}\n\nfragment lostDogsWayRoundCard on LostDogsWayRoundCard {\n  id\n  image\n  name\n  number\n  value\n  __typename\n}\n\nfragment lostDogsWayRoundCardWithResults on LostDogsWayRoundCardWithResults {\n  id\n  isWinner\n  votesPercent\n  description\n  dogsCount\n  card {\n    ...lostDogsWayRoundCard\n    __typename\n  }\n  __typename\n}\n\nfragment lostDogsWayUserRoundVote on LostDogsWayUserRoundVote {\n  cards {\n    ...lostDogsWayRoundCardWithResults\n    __typename\n  }\n  date\n  userStatus\n  selectedRoundCardValue\n  notPrize\n  woofPrize\n  taskType\n  possiblePaidReward {\n    notcoinReward\n    notcoinAmount\n    __typename\n  }\n  __typename\n}\n\nfragment lostDogsWayUserSquad on LostDogsWayUserSquad {\n  id\n  logoUrl\n  name\n  __typename\n}\n\nfragment lostDogsWayUserInfoResponse on LostDogsWayUserInfoResponse {\n  woofBalance\n  gameDogsBalance\n  currentRoundVote {\n    ...lostDogsWayCurrentRoundVote\n    __typename\n  }\n  prevRoundVote {\n    ...lostDogsWayUserRoundVote\n    __typename\n  }\n  squad {\n    ...lostDogsWayUserSquad\n    __typename\n  }\n  exchangeDone\n  storyDone\n  referralLink\n  __typename\n}\n\nfragment lostDogsWayGameStatusResponse on LostDogsWayGameStatusResponse {\n  __typename\n  gameState {\n    ... on LostDogsWayGameStatusInactive {\n      _\n      __typename\n    }\n    ... on LostDogsWayGameStatusCalculation {\n      calculationEndsAt\n      gameEndsAt\n      __typename\n    }\n    ... on LostDogsWayGameStatusRound {\n      id\n      taskType\n      roundCards {\n        ...lostDogsWayRoundCard\n        __typename\n      }\n      description\n      roundEndsAt\n      gameEndsAt\n      isGrandRound\n      notcoinBank\n      __typename\n    }\n    __typename\n  }\n}",
	);

	const query = encodeURI(
		`operationName=getHomePage&variables={}&extensions={"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
	);

	const url = `https://api.getgems.io/graphql?${query}`;

	const headers = {
		..._headers,
		"x-auth-token": queryId,
	};

	try {
		const response = await axios.get(
			url,
			proxy ? { headers, httpsAgent: new HttpsProxyAgent(proxy) } : { headers },
		);

		return response.data.data;
	} catch (e) {
		const error = e as Error;
		throw new Error(`getTime failed: ${error.message}`);
	}
};

const voteCard = async (
	prefix: string,
	queryId: string,
	proxy: string,
	value = getRandomInt(1, 3),
) => {
	try {
		const { lostDogsWayUserInfo } = await getData(prefix, queryId, proxy);

		const woofBalanceDivided =
			Number.parseFloat(lostDogsWayUserInfo.woofBalance) / 1e9;
		console.log(prefix, `${"WOOF Balance:".green} ${woofBalanceDivided}`);
		console.log(
			prefix,
			`${"BONES Balance:".green} ${lostDogsWayUserInfo.gameDogsBalance}`,
		);

		if (!lostDogsWayUserInfo.currentRoundVote) {
			await vote(prefix, queryId, proxy, value);
		} else {
			console.log(
				prefix,
				`${"Voted the card".green} ${lostDogsWayUserInfo.currentRoundVote.selectedRoundCardValue}`,
			);
			console.log(
				prefix,
				`${"Number of bones voted:".green} ${lostDogsWayUserInfo.currentRoundVote.spentGameDogsCount}`,
			);
		}
	} catch (e) {
		const error = e as Error;
		throw new Error(`voteCard failed: ${error.message}`);
	}
};

const farm = async (account: {
	phoneNumber: string;
	session: string;
	proxy: string;
}) => {
	const { phoneNumber, session, proxy } = account;
	const queryId = await getQueryId(phoneNumber, session);

	if (!queryId) {
		console.log(`Failed to get query data for ${phoneNumber}`.red);
		return;
	}

	const { extUserId } = extractUserData(queryId);
	const prefix = `[${extUserId}]`.blue;

	while (true) {
		try {
			await voteCard(prefix, queryId, proxy);

			const {
				lostDogsWayGameStatus: { gameState },
			} = await getData(prefix, queryId, proxy);

			const roundEndsAt = new Date(gameState.roundEndsAt * 1000);
			console.log(
				prefix,
				`${"The new round ends:".green} ${roundEndsAt.toLocaleDateString("en-US")}`,
			);

			await new Promise((res) =>
				setTimeout(
					res,
					+roundEndsAt - +new Date() + getRandomInt(1, 60) * 60 * 1e3,
				),
			);
		} catch (e) {
			const error = e as Error & { code?: string };
			console.log(
				prefix,
				`${"Error farm:".red} ${error.code} ${error.message}`,
			);
			await new Promise((res) => setTimeout(res, 5 * 60 * 1e3));
		}
	}
};

const start = async () => {
	const stmt = db.prepare("SELECT phoneNumber, session, proxy FROM accounts");
	const accounts = [...stmt.iterate()] as {
		phoneNumber: string;
		session: string;
		proxy: string;
	}[];

	await Promise.all(accounts.map(farm));
};

(async () => {
	ensureTableExists();

	while (true) {
		const mode = await select({
			message: "Please choose an option:",
			choices: [
				{
					name: "Start farming",
					value: "start",
					description: "Start playing game",
				},
				{
					name: "Add account",
					value: "add",
					description: "Add new account to DB",
				},
				{
					name: "Show all accounts",
					value: "show",
					description: "show all added accounts",
				},
			],
		});

		switch (mode) {
			case "add": {
				const phoneNumber = await input({
					message: "Enter your phone number (+):",
				});

				const proxy = await input({
					message:
						"Enter proxy (in format http://username:password@host:port):",
				});

				await createSession(phoneNumber, proxy);
				break;
			}
			case "show": {
				showAllAccounts();
				break;
			}
			case "start": {
				await start();
				break;
			}
			default:
				break;
		}
	}
})();
