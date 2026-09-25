const MARK = [
	"        __  __            ",
	" ____ _/ /_/ /___ ______ ",
	"/ __ `/ __/ / __ `/ ___/ ",
	"/ /_/ / /_/ / /_/ (__  )  ",
	"\\__,_/\\__/_/\\__,_/____/   ",
];

export function BigLogo() {
	return (
		<div aria-label="roms.tn" className="relative inline-block" role="img">
			<pre className="ascii select-none text-left text-[9px] text-neutral-100 sm:text-[13px] md:text-[15px]">
				{MARK.map((line, index) => (
					<div className="logo-line" key={line} style={{ animationDelay: `${100 + index * 75}ms` }}>
						{line}
					</div>
				))}
			</pre>
		</div>
	);
}

export function MiniLogo({ onClick }: { onClick?: () => void }) {
	return (
		<button
			aria-label="Clear search and return home"
			className="shrink-0 text-[15px] tracking-[-0.05em] text-neutral-100 transition-colors hover:text-acc"
			onClick={onClick}
			type="button"
		>
			roms<span className="text-acc">/</span>
		</button>
	);
}
