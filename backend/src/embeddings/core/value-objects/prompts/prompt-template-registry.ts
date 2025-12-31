import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { readFileSync, existsSync, watch } from "fs";
import { join } from "path";

/**
 * PromptTemplateConfig - Configuration structure for prompt templates
 */
interface PromptTemplateConfig {
  version: string;
  type: string;
  template: string;
}

/**
 * PromptTemplateRegistry - Manages prompt templates loaded from Markdown files
 *
 * Phase 4: Loads templates from Markdown files (with YAML frontmatter) on module initialization
 * Phase 5: Can be extended with versioning, A/B testing, and analytics
 *
 * Features:
 * - Loads templates once on initialization (memory-efficient)
 * - Hot reload support for development
 * - Fallback to hardcoded templates if Markdown files are missing
 * - Supports YAML frontmatter for metadata (version, type)
 */
@Injectable()
export class PromptTemplateRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromptTemplateRegistry.name);
  private readonly templates = new Map<string, PromptTemplateConfig>();
  private readonly promptsDir = join(process.cwd(), "prompts");
  private fileWatchers: Array<{ close: () => void }> = [];

  async onModuleInit(): Promise<void> {
    this.logger.log("Loading prompt templates from Markdown files...");
    await this.loadTemplates();

    const loadedCount = this.templates.size;
    this.logger.log(
      `Loaded ${loadedCount} prompt template(s) into memory from ${this.promptsDir}`,
    );

    // Enable hot reload in development
    if (process.env.NODE_ENV !== "production") {
      this.enableHotReload();
      this.logger.debug("Hot reload enabled for prompt templates");
    }
  }

  /**
   * Parses YAML frontmatter from Markdown content
   * Simple parser that handles basic YAML key-value pairs
   */
  private parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      // No frontmatter, return entire content as body
      return { frontmatter: {}, body: content.trim() };
    }

    const frontmatterText = match[1];
    const body = match[2].trim();

    // Simple YAML parser for key: value pairs
    const frontmatter: Record<string, string> = {};
    const lines = frontmatterText.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed
        .substring(colonIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }

    return { frontmatter, body };
  }

  /**
   * Loads all prompt templates from Markdown files
   */
  private async loadTemplates(): Promise<void> {
    const templateFiles = [
      "query-metadata.md",
      "semantic-synthesis.md",
      "query-reformulation.md",
      "history-summarization.md",
    ];

    // Also check for JSON files for backward compatibility
    const jsonFiles = [
      "query-metadata.json",
      "semantic-synthesis.json",
      "query-reformulation.json",
      "history-summarization.json",
    ];

    // Load Markdown files first
    for (const file of templateFiles) {
      try {
        const filePath = join(this.promptsDir, file);
        if (!existsSync(filePath)) {
          this.logger.debug(
            `Markdown template file not found: ${filePath}. Checking JSON fallback...`,
          );
          continue;
        }

        const content = readFileSync(filePath, "utf-8");
        const { frontmatter, body } = this.parseFrontmatter(content);

        if (!frontmatter.type || !body) {
          this.logger.error(
            `Invalid template config in ${file}: missing type in frontmatter or empty body`,
          );
          continue;
        }

        this.templates.set(frontmatter.type, {
          version: frontmatter.version || "1.0.0",
          type: frontmatter.type,
          template: body,
        });

        this.logger.debug(
          `Loaded template: ${frontmatter.type} (v${frontmatter.version || "unknown"}) from ${file}`,
        );
      } catch (error) {
        this.logger.error(`Failed to load template ${file}: ${error.message}`);
      }
    }

    // Load JSON files as fallback (for backward compatibility during migration)
    for (const file of jsonFiles) {
      // Skip if already loaded from Markdown
      const mdFile = file.replace(".json", ".md");
      const mdFilePath = join(this.promptsDir, mdFile);
      if (existsSync(mdFilePath)) {
        continue; // Markdown file exists, skip JSON
      }

      try {
        const filePath = join(this.promptsDir, file);
        if (!existsSync(filePath)) {
          continue;
        }

        this.logger.debug(
          `Loading JSON fallback: ${file} (Markdown file not found)`,
        );
        const content = readFileSync(filePath, "utf-8");
        const config: PromptTemplateConfig = JSON.parse(content);

        if (!config.type || !config.template) {
          this.logger.error(
            `Invalid template config in ${file}: missing type or template`,
          );
          continue;
        }

        this.templates.set(config.type, config);
        this.logger.debug(
          `Loaded template: ${config.type} (v${config.version || "unknown"}) from ${file}`,
        );
      } catch (error) {
        this.logger.error(`Failed to load template ${file}: ${error.message}`);
      }
    }
  }

  /**
   * Enables hot reload for prompt template files (development only)
   */
  private enableHotReload(): void {
    const templateFiles = [
      "query-metadata.md",
      "semantic-synthesis.md",
      "query-reformulation.md",
      "history-summarization.md",
    ];

    for (const file of templateFiles) {
      const filePath = join(this.promptsDir, file);
      if (!existsSync(filePath)) {
        continue;
      }

      try {
        const watcher = watch(filePath, { persistent: false }, (eventType) => {
          if (eventType === "change") {
            this.logger.log(`Template file changed: ${file}. Reloading...`);
            this.loadTemplates();
            this.logger.log(`Template ${file} reloaded successfully`);
          }
        });

        this.fileWatchers.push({
          close: () => watcher.close(),
        });
      } catch (error) {
        this.logger.warn(
          `Failed to enable hot reload for ${file}: ${error.message}`,
        );
      }
    }
  }

  /**
   * Gets a template by type
   *
   * @param type Template type identifier
   * @returns Template configuration or undefined if not found
   */
  getTemplate(type: string): PromptTemplateConfig | undefined {
    return this.templates.get(type);
  }

  /**
   * Gets the template string by type
   *
   * @param type Template type identifier
   * @returns Template string or undefined if not found
   */
  getTemplateString(type: string): string | undefined {
    return this.templates.get(type)?.template;
  }

  /**
   * Gets all loaded template types
   *
   * @returns Array of template type identifiers
   */
  getAllTypes(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Reloads templates from files (useful for hot reload or manual refresh)
   */
  async reload(): Promise<void> {
    this.logger.log("Reloading prompt templates...");
    this.templates.clear();
    await this.loadTemplates();
    this.logger.log(`Reloaded ${this.templates.size} prompt template(s)`);
  }

  /**
   * Cleanup file watchers on module destroy
   */
  onModuleDestroy(): void {
    for (const watcher of this.fileWatchers) {
      watcher.close();
    }
    this.fileWatchers = [];
  }
}
