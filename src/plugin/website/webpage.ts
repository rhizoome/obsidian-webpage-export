import { FrontMatterCache, TFile } from "obsidian";
import { ObsidianFileType, HeadingData, WebpageData } from "shared/website-data";
import { ExportPipelineOptions } from "./pipeline-options";
import { Website } from "./website";
import { Path } from "plugin/utils/path";
import { ExportLog, MarkdownRendererAPI } from "plugin/render-api/render-api";
import { AssetHandler } from "plugin/asset-loaders/asset-handler";
import { Shared } from "shared/shared";
import { Utils } from "plugin/utils/utils";


export class Webpage
{
	public website: Website;
	public options: ExportPipelineOptions;
	public source: TFile;
	public attachmentSourcePaths: string[] = [];
	public isModified: boolean = false;
	public loadedMetadata: WebpageData;
	private titleInfo = {title: "", isDefault: true};
	private iconInfo = {icon: "", isDefault: true};

	public metadata: WebpageData;
	public content: HTMLElement;
	public template: HTMLElement;


	// three files will be saved: the webpage, the metadata, and the content
	public templatePath: Path;
	public metadataPath: Path;
	public contentPath: Path;
	public pathToRoot: Path;

	public pageDocument: Document;

	private getBacklinks(): string[]
	{
		// @ts-ignore
		const backlinks = Object.keys(app.metadataCache.getBacklinksForFile(this.source)?.data) ?? [];
		let linkedWebpages = backlinks.map((path) => this.website.getTargetFilePath(path).path);
		linkedWebpages = linkedWebpages.filter((page) => page != undefined);
		return linkedWebpages;
	}
	private getFrontmatter(): FrontMatterCache
	{
		const frontmatter = app.metadataCache.getFileCache(this.source)?.frontmatter ?? {};
		return frontmatter;
	}
	private getSrcLinks(): string[]
	{
		const srcEls = this.getSrcLinkElements().map((item) => item.getAttribute("src")) as string[];
		return srcEls;
	}
	private getHrefLinks(): string[]
	{
		const hrefEls = this.getHrefLinkElements().map((item) => item.getAttribute("href")) as string[];
		return hrefEls;
	}
	private getSrcLinkElements(): HTMLImageElement[]
	{
		if (!this.content) return [];
		const srcEls = (Array.from(this.content.querySelectorAll("[src]:not(head *)")) as HTMLImageElement[]);
		return srcEls;
	}
	private getHrefLinkElements(): HTMLAnchorElement[]
	{
		if (!this.content) return [];
		const hrefEls = (Array.from(this.content.querySelectorAll("[href]:not(head *)")) as HTMLAnchorElement[]);
		return hrefEls;
	}
	private getLinksToOtherPages(): string[]
	{
		const links = this.getHrefLinks();
		let otherFiles = links.filter((link) => !link.startsWith("#") && !link.startsWith(Shared.libFolderName + "/") && !link.startsWith("https:") && !link.startsWith("http") && !link.startsWith("data:"));
		otherFiles = otherFiles.filter((link) => this.website.hasFile(link));
		return otherFiles;
	}
	private getLinksToAttachments(): string[]
	{
		const links = this.getSrcLinks();
		let attachments = links.filter((link) => !link.startsWith("#") && !link.startsWith(Shared.libFolderName + "/") && !link.startsWith("https:") && !link.startsWith("http") && !link.startsWith("data:"));
		return attachments;
	}
	private getHeadings(): {heading: string, level: number, id: string, headingEl: HTMLElement}[]
	{
		const headers: {heading: string, level: number, id: string, headingEl: HTMLElement}[] = [];
		if (this.content)
		{
			this.content.querySelectorAll(".heading").forEach((headerEl: HTMLElement) =>
			{
				let level = parseInt(headerEl.tagName[1]);
				if (headerEl.closest("[class^='block-language-']") || headerEl.closest(".markdown-embed.inline-embed")) level += 6;
				const heading = headerEl.getAttribute("data-heading") ?? headerEl.innerText ?? "";
				headers.push({heading, level, id: headerEl.id, headingEl: headerEl});
			});
		}

		return headers;
	}

	private _headingsCache: HeadingData[] = [];
	public async getRenderedHeadings(): Promise<HeadingData[]>
	{
		if (this._headingsCache.length > 0) return this._headingsCache;

		const headings = this.getHeadings().map((header) => {return {heading: header.heading, level: header.level, id: header.id}});
		
		for (const header of headings)
		{
			const tempContainer = document.body.createDiv();
			await MarkdownRendererAPI.renderMarkdownSimpleEl(header.heading, tempContainer);
			// @ts-ignore
			const h = tempContainer.innerText ?? header.heading;
			header.heading = h;
			tempContainer.remove();
		}

		this._headingsCache = headings;
		return headings;
	}

	

	constructor(website: Website, source: TFile)
	{
		this.website = website;
		this.options = website.options;
		this.source = source;
		this.templatePath = this.website.getTargetFilePath(source.path).setExtension("html");
		this.metadataPath = this.templatePath.copy.setExtension("json");
		this.contentPath = this.templatePath.copy.setFileName(this.templatePath.basename + "-content");
		this.pathToRoot = Path.getRelativePath(this.templatePath, new Path(this.templatePath.workingDirectory), true);
	}

	private isLoaded: boolean = false;
	public async load(): Promise<Webpage>
	{
		await this.initMetadata();
		this.isLoaded = true;
		return this;
	}

	private async initMetadata()
	{
		this.loadedMetadata = (await this.loadMetadata()) ?? new WebpageData();
		this.metadata = JSON.parse(JSON.stringify(this.loadedMetadata)); // clone

		// if (this.source.stat.mtime > this.metadata.modifiedTime) this.isModified = true;
		this.isModified = true; // temp

		this.metadata.stat.createdTime = this.source.stat.ctime;
		this.metadata.stat.modifiedTime = this.source.stat.mtime;
		this.metadata.stat.sourceSize = this.source.stat.size;
		this.metadata.path = this.templatePath.path;
		this.metadata.contentPath = this.contentPath.path;
		this.metadata.sourcePath = this.source.path;
		this.metadata.showInTree = true;
		this.metadata.treeOrder = 0;
		this.titleInfo = await Website.getTitle(this.source);
		this.iconInfo = await Website.getIcon(this.source);
		this.metadata.title = this.titleInfo.title;
		this.metadata.icon = this.iconInfo.icon;
		this.metadata.pathToRoot = this.pathToRoot.path;
		this.metadata.url = Path.joinStrings(this.options.siteURL, this.templatePath.path).path;

		const frontmatter = app.metadataCache.getFileCache(this.source)?.frontmatter ?? {};
		this.metadata.aliases = frontmatter["aliases"] ?? [];
		this.metadata.description = frontmatter["description"] ?? frontmatter["summary"] ?? "";
	}

	public async build(): Promise<Webpage>
	{
		if (!this.isLoaded) await this.load();
		if (!this.isModified) return this;

		this.pageDocument = document.implementation.createHTMLDocument();
		this.content = this.pageDocument.body.createDiv();

		// render file content
		this.options.container = this.content;
		const renderInfo = await MarkdownRendererAPI.renderFile(this.source, this.options);
		if (!renderInfo) return this;

		this.content.outerHTML = renderInfo.contentEl.outerHTML ?? "";
		this.metadata.type = (renderInfo.viewType as ObsidianFileType) ?? ObsidianFileType.Other;

		this.attachmentSourcePaths = this.getLinksToAttachments(); // get attachments before remapping links
		this.remapLinks();
		this.remapEmbedLinks();

		await this.fillMetadataAfterRender();

		// get template
		const pseudoHtml = this.pageDocument.body.createEl("html");
		const pseudoHead = pseudoHtml.createEl("head");
		const pseudoBody = pseudoHtml.createEl("body");

		if (this.options.addBodyClasses)
			pseudoBody.className = this.website.metadata.bodyClasses;

		pseudoBody.append(this.website.pageTemplate.getFinalLayout());

		if (this.options.addHeadTag)
			await this.addHead(pseudoHead);

		if (this.options.addTitle)
			await this.addTitle();

		this.template = pseudoHtml;

		console.log("Built webpage: ", this);

		return this;
	}

	private async fillMetadataAfterRender()
	{
		this.metadata.headers = await this.getRenderedHeadings();
		this.metadata.links = this.getLinksToOtherPages();
		this.metadata.links = this.metadata.links.filter((link) => link != this.metadata.path);
		this.metadata.backlinks = this.getBacklinks();
		this.metadata.backlinks = this.metadata.backlinks.filter((link) => link != this.metadata.path);
		this.metadata.attachments = this.getLinksToAttachments();
		this.metadata.attachments = this.metadata.attachments.filter((link) => link != this.metadata.path);
	}

	private async addHead(headEl: HTMLElement)
	{
		let rootPath = new Path(this.metadata.pathToRoot).slugified(this.options.slugifyPaths).path;
		if (rootPath == "") rootPath = ".";
		const description = this.metadata.description || (this.options.siteName + " - " + this.metadata.title);
		let head =
`
<title>${this.metadata.title}</title>
<base href="${rootPath}">
<meta name="pathname" content="${this.templatePath}">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes, minimum-scale=1.0, maximum-scale=5.0">
<meta charset="UTF-8">
<meta name="description" content="${description}">
<meta property="og:title" content="${this.metadata.title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${this.metadata.url}">
<meta property="og:image" content="${this.metadata.coverImageURL}">
<meta property="og:site_name" content="${this.options.siteName}">
`;

		// if (this.author && this.author != "")
		// {
		// 	head += `<meta name="author" content="${this.author}">`;
		// }

		// if (this.exportOptions.addRSS)
		// {
		// 	const rssURL = this.website.index.rssURL ?? "";
		// 	head += `<link rel="alternate" type="application/rss+xml" title="RSS Feed" href="${rssURL}">`;
		// }

		head += AssetHandler.getHeadReferences(this.options);

		headEl.innerHTML = head;
	}

	
	private async addTitle() 
	{
		if (!this.content || this.metadata.type != ObsidianFileType.Markdown) return;
		
		// remove inline title
		const inlineTitle = this.pageDocument.querySelector(".inline-title");
		inlineTitle?.remove();

		// remove make.md title
		const makeTitle = this.pageDocument.querySelector(".mk-inline-context");
		makeTitle?.remove();

		// remove mod-header
		const modHeader = this.pageDocument.querySelector(".mod-header");
		modHeader?.remove();

		// if the first header element is basically the same as the title, use it's text and remove it
		const firstHeader = this.pageDocument.querySelector(":is(h1, h2, h3, h4, h5, h6):not(.markdown-embed-content *)");
		if (firstHeader)
		{
			const firstHeaderText = (firstHeader.getAttribute("data-heading") ?? firstHeader.textContent)?.toLowerCase() ?? "";
			const lowerTitle = this.metadata.title.toLowerCase();
			const titleDiff = Utils.levenshteinDistance(firstHeaderText, lowerTitle) / lowerTitle.length;
			const basenameDiff = Utils.levenshteinDistance(firstHeaderText, this.source.basename.toLowerCase()) / this.source.basename.length;
			const difference = Math.min(titleDiff, basenameDiff);

			if ((firstHeader.tagName == "H1" && difference < 0.2) || (firstHeader.tagName == "H2" && difference < 0.1))
			{
				if(this.titleInfo.isDefault) 
				{
					firstHeader.querySelector(".heading-collapse-indicator")?.remove();
					this.metadata.title = firstHeader.innerHTML;
					ExportLog.log(`Using "${firstHeaderText}" header because it was very similar to the file's title.`);
				}
				else
				{
					ExportLog.log(`Replacing "${firstHeaderText}" header because it was very similar to the file's title.`);
				}
				firstHeader.remove();
			}
			else if (firstHeader.tagName == "H1" && !this.pageDocument.body.classList.contains("show-inline-title"))
			{
				// if the difference is too large but the first header is an h1 and it's the first element in the body and there is no inline title, use it as the title
				const headerEl = firstHeader.closest(".heading-wrapper") ?? firstHeader;
				const headerParent = headerEl.parentElement;
				if (headerParent && headerParent.classList.contains("markdown-preview-sizer"))
				{
					const childPosition = Array.from(headerParent.children).indexOf(headerEl);
					if (childPosition <= 2)
					{
						if(this.titleInfo.isDefault) 
						{
							firstHeader.querySelector(".heading-collapse-indicator")?.remove();
							this.metadata.title = firstHeader.innerHTML;
							ExportLog.log(`Using "${firstHeaderText}" header as title because it was H1 at the top of the page`);
						}
						else
						{
							ExportLog.log(`Replacing "${firstHeaderText}" header because it was H1 at the top of the page`);
						}

						firstHeader.remove();
					}
				}
			}
		}

		// remove banner header
		this.pageDocument.querySelector(".banner-header")?.remove();

		// Create h1 inline title
		const titleEl = this.pageDocument.createElement("h1");
		titleEl.classList.add("page-title", "heading");
		if (this.pageDocument.body.classList.contains("show-inline-title")) titleEl.classList.add("inline-title");
		titleEl.id = this.metadata.title;

		let pageIcon = undefined;
		// Create a div with icon
		if ((this.metadata.icon != "" && !this.iconInfo.isDefault))
		{
			pageIcon = this.pageDocument.createElement("div");
			pageIcon.id = "webpage-icon";
			pageIcon.innerHTML = this.metadata.icon;
		}
		
		// Insert title into the title element
		MarkdownRendererAPI.renderMarkdownSimpleEl(this.metadata.title, titleEl);
		if (pageIcon) 
		{
			titleEl.prepend(pageIcon);
		}

		// Insert title into the document
		const headerElement = this.content.querySelector(".header");
		const sizerElement = this.content.querySelector(".markdown-sizer");
		(headerElement ?? sizerElement ?? this.content).prepend(titleEl);
	}

	private headingTextToID(heading: string | null): string
	{
		return heading?.replaceAll(" ", "_").replaceAll(":", "") ?? "";
	}

	public resolveLink(link: string | null, preferAttachment: boolean = false): string | undefined
	{
		if (!link) return "";
		if ((!link.startsWith("app://") && /\w+:(\/\/|\\\\)/.exec(link)))
			return;
		if (link.startsWith("data:"))
			return;
		if (link?.startsWith("?")) 
			return;

		if (link.startsWith("#"))
		{
			let hrefValue = this.headingTextToID(link);
			if (!this.options.relativeHeaderLinks)
				hrefValue = this.templatePath + hrefValue;
			
			return hrefValue;
		}

		const linkSplit = link.split("#")[0].split("?")[0];
		const attachmentPath = this.website.getFilePathFromSrc(linkSplit, this.source.path).pathname;
		const attachmentTargetPath = this.website.getTargetFilePath(attachmentPath);
		console.log(linkSplit, attachmentPath, attachmentTargetPath);
		if (!attachmentTargetPath)
		{
			return;
		}

		let hash = link.split("#")[1] ?? "";
		if (hash != "") hash = "#" + hash;
		if (attachmentTargetPath.extensionName == "html") hash = this.headingTextToID(hash);
		return attachmentTargetPath.path + hash;
	}

	private remapLinks()
	{
		this.content.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((headerEl) =>
		{
			// convert the data-heading to the id
			headerEl.setAttribute("id", this.headingTextToID(headerEl.getAttribute("data-heading") ?? headerEl.textContent));
		});

		const links = this.getHrefLinkElements();
		for (const link of links)
		{
			const href = link.getAttribute("href");
			const newHref = this.resolveLink(href);
			link.setAttribute("href", newHref ?? href ?? "");
			link.setAttribute("target", "_self");
			link.classList.toggle("is-unresolved", !newHref);
		}
	}

	private remapEmbedLinks()
	{
		const links = this.getSrcLinkElements();
		for (const link of links)
		{
			const src = link.getAttribute("src");
			const newSrc = this.resolveLink(src, true);
			link.setAttribute("src", newSrc ?? src ?? "");
			link.setAttribute("target", "_self");
			link.classList.toggle("is-unresolved", !newSrc);
		}
	}

	//#region File IO

	public async dispose()
	{
		this.content?.remove();
		this.template?.remove();
		// @ts-ignore
		this.pageDocument = undefined;
	}

	public async save()
	{
		if (!this.isModified) return;

		await this.saveMetadata();
		await this.saveContent();
		await this.saveTemplate();
	}

	private async saveMetadata()
	{
		console.log("Saving metadata to: " + this.metadataPath.absoluted().path);
		this.metadata.stat.modifiedTime = Date.now();
		const metadata = JSON.stringify(this.metadata);
		await this.metadataPath.write(metadata);
	}

	private async saveContent()
	{
		console.log("Saving content to: " + this.contentPath.absoluted().path);
		const content = this.content.outerHTML;
		await this.contentPath.write(content);
	}

	private async saveTemplate()
	{
		console.log("Saving template to: " + this.templatePath.absoluted().path);
		const template = this.template.outerHTML;
		await this.templatePath.write(template);
	}

	private async loadMetadata(): Promise<WebpageData | undefined>
	{
		console.log("Loading metadata from: " + this.metadataPath.path);
		const metadata = await this.metadataPath.readAsString();
		if (!metadata) return undefined;

		console.log("Metadata loaded: " + metadata);
		return JSON.parse(metadata) as WebpageData;
	}

	//#endregion
}
