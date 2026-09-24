export function Highlight({
	text,
	hl,
	className = "text-acc",
}: {
	text: string;
	hl: boolean[];
	className?: string;
}) {
	const parts: { value: string; highlighted: boolean }[] = [];
	for (let index = 0; index < text.length; index++) {
		const highlighted = Boolean(hl[index]);
		const previous = parts.at(-1);
		if (previous && previous.highlighted === highlighted) previous.value += text[index];
		else parts.push({ value: text[index], highlighted });
	}
	return (
		<>
			{parts.map((part, index) =>
				part.highlighted ? (
					<mark
						className={`bg-transparent ${className} underline decoration-acc/40 decoration-1 underline-offset-[5px]`}
						key={index}
					>
						{part.value}
					</mark>
				) : (
					<span key={index}>{part.value}</span>
				),
			)}
		</>
	);
}
