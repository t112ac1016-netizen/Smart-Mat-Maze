# Smart Mat Maze

## Introduction
This is a grid-based puzzle game developed in combination with a smart floor mat. By stepping on the smart mat, players control a ray that continuously changes direction inside an invisible maze, with the goal of finding the exit.

## Gameplay
On the screen, players see a grid, with a ray entering the grid from the side. Players cannot see how the ray turns inside the grid.

When the ray encounters an obstacle or a floor mat, it always turns 90 degrees to the right, and eventually exits the grid.

Some obstacles inside the grid are randomly fixed and invisible to the player. The player must place floor mats to guide the ray, avoid these obstacles, and ultimately reach the designated exit.

## Gameplay Instructions 1
Players can control where obstacles are placed by stepping on the smart floor mat.

For example, if the player steps on tiles 6 and 8, the game will place an obstacle at coordinate (6, 8). Stepping on the same location again will remove the obstacle.

## Gameplay Instructions 2
Players can step on smart floor mat tile 9 once to launch the ray for testing.

If tile 9 is stepped on twice, all obstacles placed by the player will be cleared.

## Results
If the player successfully guides the ray into the target block within the specified time limit, the game ends with a successful clear, and the player’s score is displayed.

If the ray does not reach the target within the time limit, the game ends in failure.

## Level Editing Feature
The game also includes an editing mode, allowing instructors to design custom levels.

For example, instructors can place fixed, non-removable obstacles by pressing on-screen buttons.
