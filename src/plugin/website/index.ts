import { Attachment } from "plugin/utils/downloadable";
import { Website } from "./website";
import { TFile } from "obsidian";
import { ExportPipelineOptions } from "plugin/website/pipeline-options.js";
import { AssetHandler } from "plugin/asset-loaders/asset-handler";
import { ExportLog } from "plugin/render-api/render-api";
import Minisearch from 'minisearch';
import { Path } from "plugin/utils/path";
import { AssetType } from "plugin/asset-loaders/asset-types";
import RSS from 'rss';
import { AssetLoader } from "plugin/asset-loaders/base-asset";
import { FileData, WebpageData, WebsiteData } from "shared/website-data";
import { Shared } from "shared/shared";
import { Webpage } from "./webpage";

export class Index
{
	private website: Website;
	private get options(): ExportPipelineOptions { return this.website.options; }
	private stopWords = ["a", "about", "actually", "almost", "also", "although", "always", "am", "an", "and", "any", "are", "as", "at", "be", "became", "become", "but", "by", "can", "could", "did", "do", "does", "each", "either", "else", "for", "from", "had", "has", "have", "hence", "how", "i", "if", "in", "is", "it", "its", "just", "may", "maybe", "me", "might", "mine", "must", "my", "mine", "must", "my", "neither", "nor", "not", "of", "oh", "ok", "when", "where", "whereas", "wherever", "whenever", "whether", "which", "while", "who", "whom", "whoever", "whose", "why", "will", "with", "within", "without", "would", "yes", "yet", "you", "your"];
	private minisearchOptions = 
	{
		idField: 'path',
		fields: ['title', 'aliases', 'headers', 'tags', 'path', 'content'],
		storeFields: ['title', 'aliases', 'headers', 'tags', 'path'],
		processTerm: (term:any, _fieldName:any) =>
			this.stopWords.includes(term) ? null : term.toLowerCase()
	}

	public minisearch: Minisearch<any> | undefined = undefined;
	public rssFeed: RSS | undefined = undefined;
	public rssPath: Path;
	public rssURL: Path;
	public rssAsset: AssetLoader | undefined = undefined;


	public async load(website: Website)
	{
		this.website = website;

		// load current search index or create a new one if it doesn't exist
		try
		{			
			const indexPath = this.website.targetPath.join(AssetHandler.libraryPath).joinString(Shared.searchIndexFileName);
			const indexJson = await indexPath.readAsString();
			if (indexJson)
			{
				this.minisearch = Minisearch.loadJSON(indexJson, this.minisearchOptions);
			}
			else throw new Error("No index found");
		}
		catch (e)
		{
			ExportLog.warning(e, "Failed to load search index, creating a new one");
			this.minisearch = new Minisearch(this.minisearchOptions);
		}

		this.rssPath = AssetHandler.generateSavePath("rss.xml", AssetType.Other, this.website.targetPath);
		this.rssURL = AssetHandler.generateSavePath("rss.xml", AssetType.Other, new Path(this.options.siteURL ?? "")).absolute();
	}

	private getSearchContent(webpage: Webpage): string 
	{
		const contentElement = webpage.content;
		if (!contentElement)
		{
			return "";
		}

		const skipSelector = ".math, svg, img, .frontmatter, .metadata-container, .heading-after, style, script";
		function getTextNodes(element: HTMLElement): Node[]
		{
			const textNodes = [];
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
	
			let node;
			while (node = walker.nextNode()) 
			{
				if (node.parentElement?.closest(skipSelector))
				{
					continue;
				}

				textNodes.push(node);
			}
	
			return textNodes;
		}

		const textNodes = getTextNodes(contentElement);

		let content = '';
		for (const node of textNodes) 
		{
			content += ' ' + node.textContent + ' ';
		}

		content += webpage.metadata.links.join(" ");
		content += webpage.metadata.attachments.join(" ");

		content = content.trim().replace(/\s+/g, ' ');

		return content;
	}

	private async addWebpageToMinisearch(webpage: Webpage)
	{
		if (this.minisearch)
		{
			const webpagePath = webpage.templatePath.path;
			if (this.minisearch.has(webpagePath)) 
			{
				this.minisearch.discard(webpagePath);
			}

			const headersInfo = await webpage.getRenderedHeadings();
			if (headersInfo.length > 0 && headersInfo[0].level == 1 && headersInfo[0].heading == webpage.metadata.title) headersInfo.shift();
			const headers = headersInfo.map((header) => header.heading);

			this.minisearch.add({
				title: webpage.metadata.title,
				aliases: webpage.metadata.aliases,
				headers: headers,
				tags: webpage.metadata.inlineTags.concat(webpage.metadata.frontmatterTags),
				path: webpagePath,
				content: webpage.metadata.description + " " + this.getSearchContent(webpage),
			});
		}
	}

	private removeWebpageFromMinisearch(webpage: Webpage)
	{
		if (this.minisearch)
		{
			const webpagePath = webpage.templatePath.path;
			if (this.minisearch.has(webpagePath)) 
			{
				this.minisearch.discard(webpagePath);
			}
		}
	}
	
	public async indexPage(webpage: Webpage)
	{
		await this.addWebpageToMinisearch(webpage);
	}

	public async removePage(webpage: Webpage)
	{
		this.removeWebpageFromMinisearch(webpage);
	}

	public async saveIndex()
	{
		if (this.minisearch)
		{
			const indexPath = this.website.targetPath.join(AssetHandler.libraryPath).joinString(Shared.searchIndexFileName);
			await indexPath.write(JSON.stringify(this.minisearch));
		}
	}
}
