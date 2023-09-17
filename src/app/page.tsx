"use client";

import { useEvent } from "@/hooks/use-event";
import { Chess, Move, Square } from "chess.js";
import { useEffect, useRef, useState } from "react";
import { Chessboard } from "@gustavotoyota/react-chessboard";
import { Arrow } from "@gustavotoyota/react-chessboard/dist/chessboard/types";
import ChessLines, { ChessLine } from "@/components/chess-lines";
import { getScoreText } from "@/misc/utils";
import EvaluationBar from "@/components/evaluation-bar";
import useStateWithRef from "@/hooks/use-ref-with-state";

export default function Home() {
  const [pgn, setPgn] = useState("");

  const game = useRef(new Chess());
  const history = useRef<Move[]>([]);
  const [fen, setFen] = useState(game.current.fen());
  const moveIndex = useRef(0);

  const stockfish = useRef<Worker>();

  const currentTurn = useRef<"w" | "b">("w");

  const [bestLines, setBestLines, bestLinesRef] = useStateWithRef<
    Map<number, ChessLine>
  >(new Map());
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const numCustomMoves = useRef(0);
  const [customMoves, setCustomMoves, customMovesRef] = useStateWithRef<Move[]>(
    []
  );

  const [boardOrientation, setBoardOrientation] = useState<"white" | "black">(
    "white"
  );
  function getMoveObjects(lans: string[]): Move[] {
    const moves: Move[] = [];

    try {
      for (const lan of lans) {
        moves.push(game.current.move(lan));
      }
    } catch {}

    for (let i = 0; i < moves.length; ++i) {
      game.current.undo();
    }

    if (moves.length === lans.length) {
      return moves;
    } else {
      return lans.map(
        (lan) =>
          ({
            from: lan.slice(0, 2) as Square,
            to: lan.slice(2, 4) as Square,
            lan,
            san: "",
          } as Move)
      );
    }
  }

  useEffect(() => {
    stockfish.current = new Worker("stockfish-nnue-16.js");

    stockfish.current.onmessage = (event) => {
      console.log(event.data ? event.data : event);

      if (event.data === "uciok") {
        updateBoard();
        return;
      }

      if (event.data.startsWith("info depth")) {
        const info = event.data.split(" ");

        if (info[3] !== "seldepth") {
          return;
        }

        const lineDepth = info[2];
        const lineId = info[info.indexOf("multipv") + 1];

        if (lineDepth === "1" && lineId === "1") {
          currentTurn.current = game.current.turn();

          setBestLines(new Map());
          setArrows([]);
        }

        const lineMoves: string[] = [];

        for (
          let i = info.indexOf("pv") + 1;
          i < info.length && lineMoves.length < 15;
          i++
        ) {
          lineMoves.push(info[i]);
        }

        const scoreIndex = info.indexOf("score");

        let lineScore = parseInt(info[scoreIndex + 2]) / 100;

        if (currentTurn.current === "b") {
          lineScore = -lineScore;
        }

        const mate = info[scoreIndex + 1] === "mate";

        bestLinesRef.current.set(lineId - 1, {
          moves: getMoveObjects(lineMoves),
          mate: mate,
          score: lineScore,
          scoreText: getScoreText({ mate, score: lineScore }),
        });

        setBestLines(new Map(bestLinesRef.current));

        const newArrows: Arrow[] = [];
        const moveSet = new Set<string>();

        for (const [index, line] of Array.from(
          bestLinesRef.current.entries()
        )) {
          if (moveSet.has(line.moves[0].lan)) {
            continue;
          }

          newArrows.push({
            from: line.moves[0].from,
            to: line.moves[0].to,

            color: "red",
            width: 16 - 2 * index,

            text: line.scoreText,
            textColor: "#185bc9",
            fontSize: "15",
            fontWeight: "bold",
          });

          moveSet.add(line.moves[0].lan);
        }

        setArrows(newArrows);
      }
    };

    stockfish.current.postMessage("uci");
    stockfish.current.postMessage("setoption name Threads value 12");
    stockfish.current.postMessage("setoption name Hash value 128");
    stockfish.current.postMessage("setoption name MultiPV value 5");
  }, []);

  useEvent("keydown", (event) => {
    if (event.code === "ArrowLeft") {
      goBackward();
    } else if (event.code === "ArrowRight") {
      goForward();
    } else if (event.code === "KeyF") {
      flipBoard();
    }
  });

  function flipBoard() {
    setBoardOrientation((oldBoardOrientation) =>
      oldBoardOrientation === "white" ? "black" : "white"
    );
  }

  function updateBoard() {
    const moves = history.current
      .slice(0, moveIndex.current)
      .concat(customMovesRef.current.slice(0, numCustomMoves.current))
      .map((move) => move.lan)
      .join(" ");

    stockfish.current?.postMessage("stop");
    stockfish.current?.postMessage(
      "position startpos" + (moves !== "" ? ` moves ${moves}` : "")
    );
    stockfish.current?.postMessage("go depth 20");

    setFen(game.current.fen());
  }

  function analyze() {
    game.current.loadPgn(pgn);
    history.current = game.current.history({ verbose: true });

    stockfish.current?.postMessage("ucinewgame");
    stockfish.current?.postMessage("isready");

    numCustomMoves.current = 0;
    setCustomMoves([]);

    moveIndex.current = history.current.length;
    updateBoard();
  }

  function resetBoard() {
    game.current.reset();

    history.current = [];

    numCustomMoves.current = 0;
    setCustomMoves([]);

    moveIndex.current = 0;
    updateBoard();
  }

  function goToBeginning() {
    let executed = false;

    while (numCustomMoves.current > 0 || moveIndex.current > 0) {
      goBackward({ updateBoard: false });

      executed = true;
    }

    if (executed) {
      updateBoard();
    }
  }

  function goBackward(params?: { updateBoard?: boolean }) {
    if (numCustomMoves.current > 0) {
      numCustomMoves.current--;

      if (numCustomMoves.current <= 0 && history.current.length > 0) {
        setCustomMoves([]);
      }

      game.current.undo();
      updateBoard();
      return;
    }

    if (moveIndex.current <= 0) {
      return;
    }

    moveIndex.current = Math.max(moveIndex.current - 1, 0);

    game.current.undo();

    if (params?.updateBoard !== false) {
      updateBoard();
    }
  }

  function goForward(params?: { updateBoard?: boolean }) {
    if (customMovesRef.current.length > 0) {
      if (numCustomMoves.current < customMovesRef.current.length) {
        numCustomMoves.current++;
        game.current.move(customMovesRef.current[numCustomMoves.current - 1]);
        updateBoard();
      }

      return;
    }

    if (moveIndex.current >= history.current.length) {
      return;
    }

    game.current.move(history.current[moveIndex.current++]);

    if (params?.updateBoard !== false) {
      updateBoard();
    }
  }

  function goToEnd() {
    let executed = false;

    while (
      numCustomMoves.current < customMovesRef.current.length ||
      moveIndex.current < history.current.length
    ) {
      goForward({ updateBoard: false });

      executed = true;
    }

    if (executed) {
      updateBoard();
    }
  }

  function onPieceDrop(
    sourceSquare: Square,
    targetSquare: Square,
    piece: string
  ) {
    try {
      const move = game.current.move({
        from: sourceSquare,
        to: targetSquare,
      });

      if (move == null) {
        return false;
      }

      setCustomMoves([
        ...customMovesRef.current.slice(0, numCustomMoves.current++),
        move,
      ]);

      updateBoard();

      return true;
    } catch {
      return false;
    }
  }

  return (
    <main className="h-full flex items-center justify-center flex-col">
      <div className="flex">
        <div className="flex items-center flex-col">
          <div className="flex">
            <EvaluationBar
              mate={bestLines.get(0)?.mate ?? false}
              score={bestLines.get(0)?.score ?? 0}
            />

            <div className="w-6" />

            <div className="w-[500px]">
              <Chessboard
                position={fen}
                areArrowsAllowed={false}
                customArrows={arrows}
                onPieceDrop={onPieceDrop}
                boardOrientation={boardOrientation}
              ></Chessboard>
            </div>
          </div>

          <div className="h-8" />

          <div className="flex">
            <input
              type="button"
              value="Reset"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={resetBoard}
            />

            <div className="w-4" />

            <input
              type="button"
              value="|<"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={goToBeginning}
            />

            <div className="w-4" />

            <input
              type="button"
              value="<"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goBackward()}
            />

            <div className="w-2" />

            <input
              type="button"
              value=">"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => goForward()}
            />

            <div className="w-4" />

            <input
              type="button"
              value=">|"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={goToEnd}
            />

            <div className="w-4" />

            <input
              type="button"
              value="Flip"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => flipBoard()}
            />
          </div>

          <div className="h-8" />

          <div className="flex">
            <textarea
              className="w-80 h-20 border border-black resize-none"
              placeholder="Paste PGN here"
              value={pgn}
              onChange={(e) => setPgn(e.target.value)}
            />

            <div className="w-4" />

            <input
              type="button"
              value="Analyze"
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={analyze}
            />
          </div>
        </div>

        <div className="w-8"></div>

        <div className="w-96 bg-neutral-700 p-4 text-xs text-neutral-200">
          <ChessLines lines={bestLines} />
        </div>
      </div>
    </main>
  );
}
