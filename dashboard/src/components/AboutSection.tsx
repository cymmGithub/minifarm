import { useState, useCallback } from 'react';
import { useScrollReveal } from '../hooks/useScrollReveal';

function RevealSection({
	children,
	className = '',
	delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
	const ref = useScrollReveal<HTMLDivElement>();
	return (
		<div
			ref={ref}
			className={`reveal-on-scroll ${className}`}
			style={{ transitionDelay: `${delay}ms` }}
		>
			{children}
		</div>
	);
}

/* ─── Lightbox ─── */

function Lightbox({
	src,
	alt,
	onClose,
}: { src: string; alt: string; onClose: () => void }) {
	return (
		<div
			className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out"
			onClick={onClose}
			onKeyDown={(e) => e.key === 'Escape' && onClose()}
			role="dialog"
			aria-label="Image preview"
		>
			<div className="relative">
				<img
					src={src}
					alt={alt}
					className="max-h-[90vh] max-w-[90vw] object-contain rounded shadow-[0_0_40px_rgba(255,176,0,0.15)] animate-fade-in-up"
				/>
				<div className="absolute inset-0 pointer-events-none rounded border border-amber-500/20" />
			</div>
			<button
				type="button"
				onClick={onClose}
				className="absolute top-5 right-5 font-terminal text-2xl text-amber-500/60 hover:text-amber-400 transition-colors"
				aria-label="Close"
			>
				[ESC]
			</button>
		</div>
	);
}

/* ─── Clickable photo ─── */

function Photo({
	src,
	alt,
	caption,
	className = '',
	imgClassName = '',
	onOpen,
}: {
	src: string;
	alt: string;
	caption?: string;
	className?: string;
	imgClassName?: string;
	onOpen: (src: string, alt: string) => void;
}) {
	return (
		<figure className={className}>
			<button
				type="button"
				onClick={() => onOpen(src, alt)}
				className="amber-photo-overlay block w-full cursor-zoom-in focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded group"
			>
				<img
					src={src}
					alt={alt}
					className={`rounded border border-amber-500/20 grayscale-[30%] sepia-[20%] brightness-90 group-hover:brightness-100 group-hover:border-amber-500/40 transition-all duration-300 ${imgClassName}`}
				/>
			</button>
			{caption && (
				<figcaption className="text-xs text-amber-700/60 mt-2 font-mono">
					{'// '}{caption}
				</figcaption>
			)}
		</figure>
	);
}

/* ─── ASCII Divider ─── */

function Divider() {
	return (
		<div className="my-14 md:my-20 flex items-center justify-center">
			<span className="font-mono text-amber-500/25 text-xs tracking-[0.5em] select-none">
				{'─── ◆ ───'}
			</span>
		</div>
	);
}

/* ─── Terminal Box ─── */

function TerminalBox({
	title,
	children,
	className = '',
}: { title?: string; children: React.ReactNode; className?: string }) {
	return (
		<div className={`border border-amber-500/20 rounded bg-[#0d0d0a]/60 ${className}`}>
			{title && (
				<div className="border-b border-amber-500/15 px-4 py-2 flex items-center gap-2">
					<span className="w-2 h-2 rounded-full bg-amber-500/40" />
					<span className="w-2 h-2 rounded-full bg-amber-500/20" />
					<span className="w-2 h-2 rounded-full bg-amber-500/20" />
					<span className="ml-3 font-terminal text-sm text-amber-500/60 tracking-wider uppercase">
						{title}
					</span>
				</div>
			)}
			<div className="p-4 md:p-6">
				{children}
			</div>
		</div>
	);
}

/* ─── Architecture Diagram (ASCII-style) ─── */

function ArchitectureDiagram() {
	return (
		<TerminalBox title="network topology">
			<div className="overflow-x-auto">
				<pre className="text-amber-400/90 amber-glow whitespace-pre text-xs sm:text-sm leading-relaxed">
{`  ┌──────────────────────────────────────┐
  │  ▓ MASTER NODE                       │
  │    Ubuntu 24 Laptop                  │
  │    minifarm-master.local             │
  │                                      │
  │    ├─ Docker Swarm Manager           │
  │    ├─ Registry :5000                 │
  │    ├─ Test Orchestrator :3801        │
  │    └─ App Stack                      │
  └──────────────────┬───────────────────┘
                     │
              ┌──────┴──────┐
              │  ethernet   │
              └──────┬──────┘
                     │
          ┌──────────┴──────────┐
          │   network switch    │
          └──────────┬──────────┘
                     │
   ┌──┬──┬──┬──┬──┬──┼──┬──┬──┬──┬──┐
   │  │  │  │  │  │  │  │  │  │  │  │
   01 02 03 04 05 06 07 08 09 10 11 12

      < 12x Dell WYSE 5070 thin clients >`}
				</pre>
			</div>
		</TerminalBox>
	);
}

/* ─── Pipeline Diagram (ASCII-style) ─── */

function PipelineDiagram() {
	return (
		<TerminalBox title="test pipeline">
			<div className="font-mono text-sm overflow-x-auto">
				<pre className="text-amber-400/90 amber-glow whitespace-pre text-xs sm:text-sm leading-relaxed">
{`  PIPELINE 1 — CLIENT          PIPELINE 2 — MASTER
  ═══════════════════          ═══════════════════

  ┌─────────────────────┐      ┌─────────────────────┐
  │ Checkout tests      │      │ Deploy master apps  │
  └─────────┬───────────┘      └─────────┬───────────┘
            ▼                            ▼
  ┌─────────────────────┐      ┌─────────────────────┐
  │ Update .envs        │      │ Japa tests          │
  └─────────┬───────────┘      └─────────┬───────────┘
            ▼                            ▼
  ┌─────────────────────┐      ┌─────────────────────┐
  │ Build client image  │      │ AVA tests           │
  └─────────┬───────────┘      └─────────┬───────────┘
            ▼                            ▼
  ┌─────────────────────┐      ┌─────────────────────┐
  │ Update swarm service│      │ Reseed database     │
  └─────────┬───────────┘      └─────────┬───────────┘
            ▼                            │
  ┌─────────────────────┐                │
  │ Wait for clients    │                │
  └─────────┬───────────┘                │
            ▼                            │
  ┌─────────────────────┐                │
  │ Docker system prune │                │
  └─────────┬───────────┘                │
            │                            │
            └──────────┬─────────────────┘
                       ▼
            ╔═══════════════════════╗
            ║  PLAYWRIGHT TESTS     ║
            ║  distributed across   ║
            ║  12 client nodes      ║
            ╚═══════════╤═══════════╝
                        ▼
               ┌────────────────┐
               │  Results URL   │
               └────────────────┘`}
				</pre>
			</div>
		</TerminalBox>
	);
}

/* ─── Main Component ─── */

export function AboutSection() {
	const [lightbox, setLightbox] = useState<{
		src: string;
		alt: string;
	} | null>(null);

	const openLightbox = useCallback((src: string, alt: string) => {
		setLightbox({ src, alt });
	}, []);

	const closeLightbox = useCallback(() => {
		setLightbox(null);
	}, []);

	return (
		<article className="crt-screen bg-[#0a0a08] min-h-screen font-mono text-amber-500/80">
			{/* Lightbox overlay */}
			{lightbox && (
				<Lightbox
					src={lightbox.src}
					alt={lightbox.alt}
					onClose={closeLightbox}
				/>
			)}

			{/* ─── Hero ─── */}
			<div className="relative w-full h-[60vh] min-h-[400px] max-h-[600px] overflow-hidden">
				<img
					src="/about/hero.jpg"
					alt="The Minifarm — 12 Dell WYSE thin clients mounted in a handmade wooden rack"
					className="absolute inset-0 w-full h-full object-cover object-center grayscale-[40%] sepia-[30%] brightness-[0.6]"
				/>
				{/* Dark gradient overlay */}
				<div className="absolute inset-0 bg-gradient-to-t from-[#0a0a08] via-[#0a0a08]/60 to-[#0a0a08]/30" />
				{/* Amber tint */}
				<div className="absolute inset-0 bg-amber-900/10 mix-blend-overlay" />

				<div className="absolute bottom-0 left-0 right-0 px-6 pb-10 md:pb-14">
					<div className="max-w-prose mx-auto">
						<div className="text-amber-500/40 font-mono text-xs mb-3 tracking-widest">
							{'> cat /etc/motd'}
						</div>
						<h1 className="font-terminal text-5xl md:text-7xl text-amber-400 amber-glow-strong tracking-wide leading-none">
							THE MINIFARM
						</h1>
						<p className="mt-4 text-sm md:text-base text-amber-500/60 max-w-lg leading-relaxed font-mono">
							A distributed Playwright testing infrastructure built
							from 12 Dell WYSE thin clients, a wooden rack, and a
							lot of ethernet cable.
						</p>
						<div className="mt-4 text-amber-500/30 font-mono text-xs blink-cursor">
							{'[MINIFARM] user@minifarm-master: ~ $'}
						</div>
					</div>
				</div>
			</div>

			{/* ─── Content ─── */}
			<div className="max-w-prose mx-auto px-6 py-16 md:py-24">
				{/* Introduction */}
				<RevealSection>
					<p className="text-sm md:text-base text-amber-500/70 leading-relaxed">
						The Minifarm parallelizes end-to-end test execution across a
						farm of repurposed thin clients. An Ubuntu laptop serves as the
						master node, orchestrating Docker Swarm services across 12
						Alpine Linux machines — each running Chromium and Playwright
						inside containers.
					</p>
					<p className="mt-5 text-sm md:text-base text-amber-500/70 leading-relaxed">
						What started as a way to speed up a slow CI pipeline became a
						small hardware project: sourcing retired corporate thin
						clients, building a wooden rack to house them, wiring custom
						power distribution, and writing the orchestration software to
						tie it all together.
					</p>
				</RevealSection>

				<Divider />

				{/* The Build */}
				<RevealSection>
					<div className="flex items-center gap-3 mb-6">
						<span className="text-amber-500/30 font-mono text-xs">{'>'}</span>
						<h2 className="font-terminal text-3xl md:text-4xl text-amber-400 amber-glow tracking-wider">
							THE BUILD
						</h2>
					</div>
				</RevealSection>

				<RevealSection>
					<Photo
						src="/about/closeup.jpg"
						alt="Underside of the rack showing wooden slat separators and custom DC power wiring with Wago connectors"
						caption="The underside of the rack — wooden slat separators hold each thin client in place, while custom-soldered DC barrel connectors distribute 19V power from salvaged laptop chargers."
						className="mb-10"
						imgClassName="w-full max-w-lg mx-auto block aspect-[4/3] object-cover object-center"
						onOpen={openLightbox}
					/>
				</RevealSection>

				<RevealSection>
					<p className="text-sm text-amber-500/70 leading-relaxed">
						Each Dell WYSE 5070 draws roughly 10 watts at idle. The
						rack is built from pine wood with a perforated metal sheet
						as the base for passive airflow. A managed Ethernet switch
						connects all nodes to the master via mDNS — no static IP
						configuration needed.
					</p>
				</RevealSection>

				<Divider />

				{/* Architecture */}
				<RevealSection>
					<div className="flex items-center gap-3 mb-3">
						<span className="text-amber-500/30 font-mono text-xs">{'>'}</span>
						<h2 className="font-terminal text-3xl md:text-4xl text-amber-400 amber-glow tracking-wider">
							BIRD'S EYE VIEW
						</h2>
					</div>
					<p className="text-sm text-amber-500/70 leading-relaxed mb-8">
						Docker Swarm manages the cluster. The master node runs the
						test orchestration server, a private Docker registry, and the
						full application stack. Client nodes pull container
						images from the registry and execute Playwright tests on
						demand.
					</p>
				</RevealSection>

				<RevealSection>
					<ArchitectureDiagram />
				</RevealSection>

				<RevealSection className="mt-8">
					<p className="text-xs text-amber-500/40 leading-relaxed font-mono">
						{'// '}Each client runs 2 parallel Playwright instances, giving
						the cluster a total capacity of 24 simultaneous test executions.
					</p>
				</RevealSection>

				<Divider />

				{/* Pipeline */}
				<RevealSection>
					<div className="flex items-center gap-3 mb-3">
						<span className="text-amber-500/30 font-mono text-xs">{'>'}</span>
						<h2 className="font-terminal text-3xl md:text-4xl text-amber-400 amber-glow tracking-wider">
							TEST PIPELINE
						</h2>
					</div>
					<p className="text-sm text-amber-500/70 leading-relaxed mb-2">
						Pipelines are fired from the dashboard's
						{' '}<span className="text-amber-400/90">Start New Pipeline</span>{' '}
						section. Under the hood, this triggers:
					</p>
					<div className="bg-[#0d0d0a] border border-amber-500/15 rounded px-4 py-2.5 mb-8 inline-block">
						<code className="text-amber-400/90 text-sm font-mono amber-glow">
							<span className="text-amber-500/40">$ </span>
							./minifarm.js test MN-4000
						</code>
					</div>
					<p className="text-sm text-amber-500/70 leading-relaxed mb-8">
						That kicks off two parallel pipelines. The client pipeline
						builds and deploys containers while the master pipeline runs
						backend tests and reseeds the database. Only when both
						complete do Playwright tests fan out across the cluster.
					</p>
				</RevealSection>

				<RevealSection>
					<PipelineDiagram />
				</RevealSection>

				<Divider />

				{/* Specs */}
				<RevealSection>
					<div className="flex items-center gap-3 mb-8">
						<span className="text-amber-500/30 font-mono text-xs">{'>'}</span>
						<h2 className="font-terminal text-3xl md:text-4xl text-amber-400 amber-glow tracking-wider">
							SPECIFICATIONS
						</h2>
					</div>
				</RevealSection>

				<RevealSection>
					<TerminalBox title="sys info">
						<table className="w-full text-sm font-mono">
							<tbody>
								{[
									['Master Node', 'Ubuntu 24 laptop'],
									['Client Nodes', '12x Dell WYSE 5070 thin clients'],
									['Client OS', 'Alpine Linux'],
									['Orchestration', 'Docker Swarm (1 mgr + workers)'],
									['Registry', 'Private Docker registry :5000'],
									['Test Framework', 'Playwright 1.57 + Chromium'],
									['Server Port', ':3801 (orchestrator)'],
									['Client Port', ':3802 (per client)'],
									['Discovery', 'mDNS (.local hostnames)'],
									['Max Parallelism', '24 concurrent (12 x 2 workers)'],
									['Power Draw', '~120W total (10W x 12 clients)'],
									['Rack Material', 'Pine wood + perforated steel'],
								].map(([label, value], i) => (
									<tr
										key={label}
										className={i % 2 === 0 ? 'bg-amber-500/[0.02]' : ''}
									>
										<td className="px-2 py-1.5 text-amber-500/50 whitespace-nowrap border-r border-amber-500/10 text-xs">
											{label}
										</td>
										<td className="px-3 py-1.5 text-amber-400/70 text-xs">
											{value}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</TerminalBox>
				</RevealSection>

				<Divider />

				{/* Gallery */}
				<RevealSection>
					<div className="flex items-center gap-3 mb-8">
						<span className="text-amber-500/30 font-mono text-xs">{'>'}</span>
						<h2 className="font-terminal text-3xl md:text-4xl text-amber-400 amber-glow tracking-wider">
							GALLERY
						</h2>
					</div>
				</RevealSection>
			</div>

			{/* Photo gallery */}
			<div className="max-w-3xl mx-auto px-6 pb-8">
				<div className="grid grid-cols-2 gap-4">
					<RevealSection>
						<Photo
							src="/about/side.jpg"
							alt="Side view of the rack showing USB and DisplayPort connectors, ethernet cables, and LED indicators"
							caption="Side profile — ethernet and power cables routed through the wooden frame"
							imgClassName="w-full aspect-[4/3] object-cover"
							onOpen={openLightbox}
						/>
					</RevealSection>
					<RevealSection delay={100}>
						<Photo
							src="/about/wiring.jpg"
							alt="Inside view of the rack showing custom DC power wiring with barrel connectors"
							caption="Inner wiring detail with DC barrel connectors"
							imgClassName="w-full aspect-[4/3] object-cover"
							onOpen={openLightbox}
						/>
					</RevealSection>
					<RevealSection delay={50}>
						<Photo
							src="/about/bottom.jpg"
							alt="Bottom view of the rack showing power distribution and adapters mounted to perforated metal base"
							caption="Underside — power adapters and strip mounted to the perforated base"
							imgClassName="w-full aspect-[4/3] object-cover"
							onOpen={openLightbox}
						/>
					</RevealSection>
					<RevealSection delay={150}>
						<Photo
							src="/about/hero.jpg"
							alt="Front three-quarter view of the complete minifarm"
							caption="The complete farm with all 12 clients and the network switch visible below"
							imgClassName="w-full aspect-[4/3] object-cover"
							onOpen={openLightbox}
						/>
					</RevealSection>
				</div>
			</div>

			{/* Footer */}
			<div className="max-w-prose mx-auto px-6 pb-20 pt-10">
				<div className="flex items-center justify-center mb-6">
					<span className="font-mono text-amber-500/20 text-xs tracking-[0.5em]">
						{'─── ◆ ───'}
					</span>
				</div>
				<p className="text-center text-xs text-amber-500/30 font-mono">
					{'// '}Built with wood, ethernet, and stubbornness.
				</p>
				<p className="text-center text-xs text-amber-500/15 font-mono mt-2">
					{'[EOF]'}
				</p>
			</div>
		</article>
	);
}
