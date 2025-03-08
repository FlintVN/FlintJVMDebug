## FlintJVM Debug extension for Visual Studio Code
![demo](https://raw.githubusercontent.com/FlintVN/FlintJVMDebug/refs/heads/master/images/gifs/demo.gif)  
A [Visual Studio Code](https://code.visualstudio.com/) [extension](https://marketplace.visualstudio.com/VSCode) support for the debugging java language with [FlintJVM](https://github.com/FlintVN/FlintJVM).  
It Provides basic features such as:
- Pause, Continue, Restart.
- Step Over, Step Into, Step Out.
- Stack trace.
- Set and remove breakpoints.
- Stop on exception and display exception information.
- View local variables and evaluate expressions.
- Display message printed from java code.
## How to use
1. Install [FlintJVM Debug](https://marketplace.visualstudio.com/items?itemName=ElectricThanhTung.flintjvm-debugger) extension on VS Code.
2. Click on the "**Install**" button.
3. In the new window, open the your java project that will be run on [FlintJVM](https://github.com/FlintVN/FlintJVM).
4. Open `Run > Add Configuration... > Flint Debug` to add ***launch.json*** with default configuration.
5. Change the default properties in ***launch.json*** to match your project.
6. Press `F5` to start debugging your java project.
## Contribute
1. Clone and open this [repo](https://github.com/FlintVN/FlintJVMDebug) in VS Code.
2. Run `npm install` to install the dependencies.
3. Press `F5` to open a new window with your extension loaded.