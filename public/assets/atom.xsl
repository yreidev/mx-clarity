<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:atom="http://www.w3.org/2005/Atom">
	<xsl:output method="html" indent="yes" />

	<xsl:template match="/">
		<html lang="{atom:feed/atom:language}">

		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title><xsl:value-of select="atom:feed/atom:title" /></title>
			<link rel="stylesheet" href="/assets/atom.css" />
			<link rel="icon" href="{atom:feed/atom:icon}" />
			<meta name="referrer" content="no-referrer" />
			<script src="/assets/atom.js" defer="defer"></script>
		</head>

		<body>
			<header class="logo-header">
				<img class="logo" src="{atom:feed/atom:logo}" alt="" />
				<div>
					<h1 class="title"><xsl:value-of select="atom:feed/atom:title" /></h1>
					<div class="subtitle"><xsl:value-of select="atom:feed/atom:subtitle" /></div>
				</div>
			</header>

			<blockquote>
				<p>本页面是 Atom 订阅源，可直接被订阅。</p>
				<p class="description"><xsl:value-of select="atom:feed/atom:description" /></p>
			</blockquote>

			<main>
				<xsl:apply-templates select="atom:feed/atom:entry" />
			</main>

			<footer>
				<xsl:value-of select="atom:feed/atom:rights" />
				<br />
				由 <xsl:value-of select="atom:feed/atom:generator" /> 生成
			</footer>
		</body>

		</html>
	</xsl:template>

	<xsl:template match="atom:entry">
		<a href="#{atom:id}" class="entry">
			<xsl:variable name="img-src"
				select="substring-before(substring-after(substring-after(atom:content, '&lt;img'), 'src=&quot;'), '&quot;')" />
			<xsl:if test="$img-src">
				<img class="entry-image" src="{$img-src}" alt="{atom:title}" loading="lazy" />
			</xsl:if>

			<article>
				<h2 class="entry-title">
					<xsl:value-of select="atom:title" />
				</h2>

				<xsl:if test="atom:summary">
					<div class="entry-summary">
						<xsl:value-of select="atom:summary" />
					</div>
				</xsl:if>

				<div class="entry-meta">
					发布于
					<time datetime="{atom:published}">
						<xsl:value-of select="atom:published" />
					</time>

					<xsl:if test="atom:updated and atom:updated != atom:published">
						· 更新于
						<time datetime="{atom:updated}">
							<xsl:value-of select="atom:updated" />
						</time>
					</xsl:if>

					<xsl:if test="atom:category">
						·
						<xsl:for-each select="atom:category">
							<xsl:value-of select="@term" />
						</xsl:for-each>
					</xsl:if>
				</div>
			</article>
		</a>

		<!-- 正文只给阅读器：这里只显示摘要与原文链接，不把 content 当 HTML 插进页面（同源页面，没有 CSP 兜底） -->
		<section class="entry-content-container" id="{atom:id}">
			<a class="entry-content-close" href="#">×</a>
			<figure class="entry-content">
				<figcaption>
					<xsl:value-of select="atom:title" />
				</figcaption>
				<p><xsl:value-of select="atom:summary" /></p>
				<p><a class="view-full" href="{atom:link/@href}">在网站上阅读</a></p>
			</figure>
		</section>
	</xsl:template>

</xsl:stylesheet>