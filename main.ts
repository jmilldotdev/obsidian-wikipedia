import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
  TextComponent,
} from "obsidian";

interface WikiExtract {
  title: string;
  text: string;
  url: string;
}

interface MyPluginSettings {
  template: string;
  shouldUseParagraphTemplate: boolean;
  shouldBoldTitle: boolean;
  paragraphTemplate: string;
  language: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  template: `{{text}}\n> [Wikipedia]({{url}})`,
  shouldUseParagraphTemplate: true,
  shouldBoldTitle: true,
  paragraphTemplate: `> {{paragraphText}}\n>\n`,
  language: "en",
};

const extractApiUrl =
  "wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&redirects&origin=*&titles=";

const disambiguationIdentifier = "may refer to:";
export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  getUrl(title: string): string {
    return `https://${this.settings.language}.wikipedia.org/wiki/${encodeURI(
      title
    )}`;
  }

  getApiUrl(): string {
    return `https://${this.settings.language}.` + extractApiUrl;
  }

  formatExtractText(extract: WikiExtract, searchTerm: string): string {
    const text = extract.text;
    let formattedText: string = "";
    if (this.settings.shouldUseParagraphTemplate) {
      const split = text.split("==")[0].trim().split("\n");
      formattedText = split
        .map((paragraph) =>
          this.settings.paragraphTemplate.replace(
            "{{paragraphText}}",
            paragraph
          )
        )
        .join("")
        .trim();
    } else {
      formattedText = text.split("==")[0].trim();
    }
    if (this.settings.shouldBoldTitle) {
      const pattern = new RegExp(searchTerm, "i");
      formattedText = formattedText.replace(pattern, `**${searchTerm}**`);
    }
    return formattedText;
  }

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found on Wikipedia.`);
  }

  handleCouldntResolveDisambiguation() {
    new Notice(`Could not automatically resolve disambiguation.`);
  }

  hasDisambiguation(extract: WikiExtract) {
    if (extract.text.includes(disambiguationIdentifier)) {
      return true;
    }
    return false;
  }

  parseResponse(json: any): WikiExtract | undefined {
    const pages = json.query.pages;
    const pageKeys = Object.keys(pages);
    if (pageKeys.includes("-1")) {
      return undefined;
    }
    const extracts: WikiExtract[] = pageKeys.map((key) => {
      const page = pages[key];
      const extract: WikiExtract = {
        title: page.title,
        text: page.extract,
        url: this.getUrl(page.title),
      };
      return extract;
    });
    return extracts[0];
  }

  formatExtractInsert(extract: WikiExtract, searchTerm: string): string {
    const formattedText = this.formatExtractText(extract, searchTerm);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{searchTerm}}", searchTerm)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWikipediaText(title: string): Promise<WikiExtract | undefined> {
    const url = this.getApiUrl() + encodeURIComponent(title);
    const json = await fetch(url)
      .then((response) => response.json())
      .catch(() => new Notice('Failed to get Wikipedia. Check your internet connection or language prefix.'));
    const extract = this.parseResponse(json);
    return extract;
  }

  async pasteIntoEditor(searchTerm: string) {
    let extract: WikiExtract = await this.getWikipediaText(searchTerm);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    if (this.hasDisambiguation(extract)) {
      new Notice(
        `Disambiguation found for ${searchTerm}. Choosing first result.`
      );
      console.log(extract);
      const newSearchTerm = extract.text
        .split(disambiguationIdentifier)[1]
        .trim()
        .split(",")[0]
        .split("==")
        .pop()
        .trim();
      console.log(newSearchTerm);
      extract = await this.getWikipediaText(newSearchTerm);
      if (!extract) {
        this.handleCouldntResolveDisambiguation();
        return;
      }
    }
    const editor = this.getEditor();
    editor.replaceSelection(this.formatExtractInsert(extract, searchTerm));
  }

  async getWikipediaTextForActiveFile() {
    const searchTerm = await this.app.workspace.getActiveFile().basename;
    await this.pasteIntoEditor(searchTerm);
  }

  async getWikipediaTextForSearchTerm() {
    new SearchModal(this.app, this).open();
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "wikipedia-get-active-note-title",
      name: "Get Wikipedia for Active Note Title",
      callback: () => this.getWikipediaTextForActiveFile(),
    });

    this.addCommand({
      id: "wikipedia-get-search-term",
      name: "Get Wikipedia for Search Term",
      callback: () => this.getWikipediaTextForSearchTerm(),
    });

    this.addSettingTab(new SampleSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private getEditor(): Editor {
    let activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeLeaf == null) return;
    return activeLeaf.editor;
  }
}

class SearchModal extends Modal {
  searchTerm: string;
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    let { contentEl } = this;

    contentEl.createEl("h2", { text: "Enter Search Term:" });

    const inputs = contentEl.createDiv("inputs");
    const searchInput = new TextComponent(inputs).onChange((searchTerm) => {
      this.searchTerm = searchTerm;
    });
    searchInput.inputEl.focus();
    searchInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.close();
      }
    });

    const controls = contentEl.createDiv("controls");
    const searchButton = controls.createEl("button", {
      text: "Search",
      cls: "mod-cta",
      attr: {
        autofocus: true,
      },
    });
    searchButton.addEventListener("click", this.close.bind(this));
    const cancelButton = controls.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", this.close.bind(this));
  }

  async onClose() {
    let { contentEl } = this;

    contentEl.empty();
    if (this.searchTerm) {
      await this.plugin.pasteIntoEditor(this.searchTerm);
    }
  }
}

class SampleSettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Wikipedia" });

    new Setting(containerEl)
      .setName("Wikipedia Language")
      .setDesc(`Choose Wikipedia language prefix to use (ex. en for English)`)
      .addText((textField) => {
        textField
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Wikipedia Extract Template")
      .setDesc(
        `Set markdown template for extract to be inserted.\n
        Available template variables are {{text}}, {{searchTerm}} and {{url}}.
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.template)
          .onChange(async (value) => {
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Bold Title?")
      .setDesc(
        "If set to true, the first instance of the page title will be **bolded**"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldBoldTitle)
          .onChange(async (value) => {
            this.plugin.settings.shouldBoldTitle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Use paragraph template?")
      .setDesc(
        "If set to true, the paragraph template will be inserted for each paragraph of text for {{text}} in main template."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldUseParagraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.shouldUseParagraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Paragraph Template")
      .setDesc(
        `Set markdown template for extract paragraphs to be inserted.\n
        Available template variables are: {{paragraphText}}
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.paragraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.paragraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
